import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import "dotenv/config";
import { PrismaClient, SignatureRequestStatus, TaskStatus } from "@prisma/client";
import { Job, Worker } from "bullmq";
import IORedis from "ioredis";
import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Readable } from "node:stream";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  SEAWEED_S3_ENDPOINT: z.string().url(),
  SEAWEED_S3_REGION: z.string().min(1),
  SEAWEED_S3_BUCKET: z.string().min(1),
  SEAWEED_S3_ACCESS_KEY: z.string().min(1),
  SEAWEED_S3_SECRET_KEY: z.string().min(1),
  QPDF_BIN: z.string().default("qpdf")
});

const env = EnvSchema.parse(process.env);
const queueName = "pdf-tasks";

const prisma = new PrismaClient();
const redisConnection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
const s3 = new S3Client({
  endpoint: env.SEAWEED_S3_ENDPOINT,
  region: env.SEAWEED_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.SEAWEED_S3_ACCESS_KEY,
    secretAccessKey: env.SEAWEED_S3_SECRET_KEY
  }
});

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

async function toBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

async function downloadObject(objectKey: string): Promise<Buffer> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: env.SEAWEED_S3_BUCKET,
      Key: objectKey
    })
  );

  if (!response.Body) {
    throw new Error(`Empty object for key ${objectKey}.`);
  }

  return toBuffer(response.Body as Readable);
}

async function ensureBucket(): Promise<void> {
  try {
    await s3.send(
      new HeadBucketCommand({
        Bucket: env.SEAWEED_S3_BUCKET
      })
    );
  } catch {
    await s3.send(
      new CreateBucketCommand({
        Bucket: env.SEAWEED_S3_BUCKET
      })
    );
  }
}

async function uploadObject(
  objectKey: string,
  contentType: string,
  body: Buffer,
  fileName: string
): Promise<string> {
  await s3.send(
    new PutObjectCommand({
      Bucket: env.SEAWEED_S3_BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
      Metadata: {
        filename: fileName
      }
    })
  );

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
  const workdir = await mkdtemp(join(tmpdir(), "ihatepdf-merge-"));

  try {
    const inputPaths: string[] = [];

    for (let index = 0; index < payload.fileKeys.length; index += 1) {
      const key = payload.fileKeys[index];
      const data = await downloadObject(key);
      const path = join(workdir, `input-${index + 1}.pdf`);
      await writeFile(path, data);
      inputPaths.push(path);
    }

    const outputPath = join(workdir, safePdfName(payload.outputName));
    await execFileAsync(env.QPDF_BIN, ["--empty", "--pages", ...inputPaths, "--", outputPath]);

    const outputBuffer = await readFile(outputPath);
    const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safePdfName(
      payload.outputName
    )}`;

    return uploadObject(objectKey, "application/pdf", outputBuffer, safePdfName(payload.outputName));
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

function validatePageRanges(ranges: string[]): void {
  for (const range of ranges) {
    if (!/^\d+(-\d+)?$/.test(range)) {
      throw new Error(`Invalid page range: ${range}. Use values like 1 or 2-4.`);
    }
  }
}

async function runSplit(payload: SplitPayload): Promise<string> {
  validatePageRanges(payload.pageRanges);

  const workdir = await mkdtemp(join(tmpdir(), "ihatepdf-split-"));

  try {
    const inputPath = join(workdir, "input.pdf");
    await writeFile(inputPath, await downloadObject(payload.fileKey));

    const outputPaths: string[] = [];

    for (let index = 0; index < payload.pageRanges.length; index += 1) {
      const range = payload.pageRanges[index];
      const outputPath = join(workdir, `${payload.outputPrefix}-${range}.pdf`);
      await execFileAsync(env.QPDF_BIN, [inputPath, "--pages", inputPath, range, "--", outputPath]);
      outputPaths.push(outputPath);
    }

    if (outputPaths.length === 1) {
      const onlyPath = outputPaths[0];
      const fileName = safePdfName(`${payload.outputPrefix}-${payload.pageRanges[0]}.pdf`);
      const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
      const body = await readFile(onlyPath);
      return uploadObject(objectKey, "application/pdf", body, fileName);
    }

    const zip = new JSZip();
    for (const path of outputPaths) {
      const fileData = await readFile(path);
      const name = path.split("/").at(-1) ?? `${randomUUID()}.pdf`;
      zip.file(name, fileData);
    }

    const zipData = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const zipName = `${payload.outputPrefix}-split.zip`;
    const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${zipName}`;

    return uploadObject(objectKey, "application/zip", zipData, zipName);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
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
  await prisma.$connect();
  await ensureBucket();

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
    await redisConnection.quit();
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
