import "dotenv/config";
import { Job, Worker } from "bullmq";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { PrismaClient, SignatureRequestStatus, TaskStatus } =
  require("@prisma/client") as typeof import("@prisma/client");

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  STORAGE_DIR: z.string().default("../../storage")
});

const env = EnvSchema.parse(process.env);
const storageRoot = resolve(env.STORAGE_DIR);
const queueName = "pdf-tasks";
const STARTUP_RETRY_ATTEMPTS = 15;
const STARTUP_RETRY_DELAY_MS = 1500;

const prisma = new PrismaClient();
const redisConnection = (() => {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null as null
  };
})();

const MergePayloadSchema = z.object({
  taskId: z.string(),
  fileKeys: z.array(z.string()).min(2),
  outputName: z.string().min(1)
});

const SplitPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  pageRanges: z.array(z.string()).min(1),
  outputPrefix: z.string().min(1)
});

const SignPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  signatureDataUrl: z.string().startsWith("data:image/"),
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  outputName: z.string().min(1)
});

type MergePayload = z.infer<typeof MergePayloadSchema>;
type SplitPayload = z.infer<typeof SplitPayloadSchema>;
type SignPayload = z.infer<typeof SignPayloadSchema>;

function safePdfName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, "_");
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

function isJpegDataUrl(dataUrl: string): boolean {
  return dataUrl.startsWith("data:image/jpeg") || dataUrl.startsWith("data:image/jpg");
}

function parseDataUrl(dataUrl: string): Buffer {
  const splitIndex = dataUrl.indexOf(",");
  if (splitIndex === -1) {
    throw new Error("Invalid signature data URL.");
  }

  const base64 = dataUrl.slice(splitIndex + 1);
  return Buffer.from(base64, "base64");
}

function resolveStoragePath(objectKey: string): string {
  const absolutePath = resolve(storageRoot, objectKey);

  if (absolutePath !== storageRoot && !absolutePath.startsWith(`${storageRoot}${sep}`)) {
    throw new Error("Invalid object key path traversal attempt.");
  }

  return absolutePath;
}

async function ensureStorageDir(): Promise<void> {
  await mkdir(storageRoot, { recursive: true });
}

async function downloadObject(objectKey: string): Promise<Buffer> {
  return readFile(resolveStoragePath(objectKey));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveFn) => setTimeout(resolveFn, ms));
}

async function retry<T>(
  label: string,
  operation: () => Promise<T>,
  attempts: number,
  delayMs: number
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.error(`[startup:${label}] attempt ${attempt}/${attempts} failed: ${errorMessage(error)}`);
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }

  throw lastError;
}

async function uploadObject(
  objectKey: string,
  contentType: string,
  body: Buffer,
  fileName: string
): Promise<string> {
  const path = resolveStoragePath(objectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);

  const file = await prisma.fileObject.create({
    data: {
      objectKey,
      fileName,
      mimeType: contentType,
      sizeBytes: BigInt(body.byteLength)
    }
  });

  return file.id;
}

async function markProcessing(taskId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: { status: TaskStatus.processing }
  });
}

async function markFailed(taskId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown task error";
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.failed,
      errorMessage: message
    }
  });

  await prisma.signatureRequest.updateMany({
    where: {
      signedTaskId: taskId,
      status: SignatureRequestStatus.pending
    },
    data: {
      status: SignatureRequestStatus.cancelled
    }
  });
}

async function markCompleted(taskId: string, outputFileId: string): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.completed,
      outputFileId,
      errorMessage: null
    }
  });

  await prisma.signatureRequest.updateMany({
    where: {
      signedTaskId: taskId,
      status: SignatureRequestStatus.pending
    },
    data: {
      status: SignatureRequestStatus.completed,
      signedAt: new Date()
    }
  });
}

async function runMerge(payload: MergePayload): Promise<string> {
  const merged = await PDFDocument.create();

  for (const key of payload.fileKeys) {
    const sourceBuffer = await downloadObject(key);
    const source = await PDFDocument.load(sourceBuffer);
    const copiedPages = await merged.copyPages(source, source.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  const outputBuffer = Buffer.from(await merged.save());
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

function validatePageRanges(ranges: string[]): void {
  for (const range of ranges) {
    if (!/^\d+(-\d+)?$/.test(range)) {
      throw new Error(`Invalid page range: ${range}. Use values like 1 or 2-4.`);
    }
  }
}

function parseRange(range: string, totalPages: number): number[] {
  const [startRaw, endRaw] = range.split("-");
  const start = Number(startRaw);
  const end = endRaw ? Number(endRaw) : start;

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < 1 ||
    start > end ||
    end > totalPages
  ) {
    throw new Error(`Invalid page range: ${range}. PDF has ${totalPages} page(s).`);
  }

  const pageIndices: number[] = [];
  for (let page = start; page <= end; page += 1) {
    pageIndices.push(page - 1);
  }

  return pageIndices;
}

async function runSplit(payload: SplitPayload): Promise<string> {
  validatePageRanges(payload.pageRanges);

  const sourceBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const chunks = payload.pageRanges.map((range) => ({ range, pages: parseRange(range, totalPages) }));

  if (chunks.length === 1) {
    const only = chunks[0];
    const splitDoc = await PDFDocument.create();
    const copiedPages = await splitDoc.copyPages(source, only.pages);
    copiedPages.forEach((page) => splitDoc.addPage(page));

    const body = Buffer.from(await splitDoc.save());
    const fileName = safePdfName(`${payload.outputPrefix}-${only.range}.pdf`);
    const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
    return uploadObject(objectKey, "application/pdf", body, fileName);
  }

  const zip = new JSZip();
  for (const chunk of chunks) {
    const splitDoc = await PDFDocument.create();
    const copiedPages = await splitDoc.copyPages(source, chunk.pages);
    copiedPages.forEach((page) => splitDoc.addPage(page));
    const splitBytes = Buffer.from(await splitDoc.save());
    const fileName = safePdfName(`${payload.outputPrefix}-${chunk.range}.pdf`);
    zip.file(fileName, splitBytes);
  }

  const zipData = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${payload.outputPrefix}-split.zip`;
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${zipName}`;

  return uploadObject(objectKey, "application/zip", zipData, zipName);
}

async function runSign(payload: SignPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const pdfDoc = await PDFDocument.load(inputBuffer);

  const pages = pdfDoc.getPages();
  if (payload.page > pages.length) {
    throw new Error(`Invalid page number ${payload.page}. PDF has ${pages.length} page(s).`);
  }

  const signatureImage = parseDataUrl(payload.signatureDataUrl);
  const embeddedImage = isJpegDataUrl(payload.signatureDataUrl)
    ? await pdfDoc.embedJpg(signatureImage)
    : await pdfDoc.embedPng(signatureImage);

  const page = pages[payload.page - 1];
  page.drawImage(embeddedImage, {
    x: payload.x,
    y: payload.y,
    width: payload.width,
    height: payload.height
  });

  const signed = await pdfDoc.save();
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  return uploadObject(objectKey, "application/pdf", Buffer.from(signed), fileName);
}

async function processJob(job: Job): Promise<void> {
  const { name, data } = job;

  if (name === "merge") {
    const payload = MergePayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runMerge(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "split") {
    const payload = SplitPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runSplit(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "sign") {
    const payload = SignPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runSign(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  throw new Error(`Unsupported job name: ${name}`);
}

async function bootstrap(): Promise<void> {
  await retry("prisma-connect", () => prisma.$connect(), STARTUP_RETRY_ATTEMPTS, STARTUP_RETRY_DELAY_MS);
  await retry("ensure-storage-dir", () => ensureStorageDir(), STARTUP_RETRY_ATTEMPTS, STARTUP_RETRY_DELAY_MS);

  const worker = new Worker(
    queueName,
    async (job) => {
      try {
        await processJob(job);
      } catch (error) {
        const taskId = (job.data as { taskId?: string }).taskId;
        if (taskId) {
          await markFailed(taskId, error);
        }
        throw error;
      }
    },
    {
      connection: redisConnection,
      concurrency: 4
    }
  );

  worker.on("ready", () => {
    console.log("PDF worker is ready");
  });

  worker.on("failed", (job, error) => {
    console.error("Task failed", {
      jobId: job?.id,
      jobName: job?.name,
      error: error.message
    });
  });

  const shutdown = async (): Promise<void> => {
    await worker.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });

  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void bootstrap();
