import "dotenv/config";
import { Job, Worker } from "bullmq";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, resolve, sep } from "node:path";
import { inflateRawSync, inflateSync } from "node:zlib";
import { z } from "zod";

const require = createRequire(import.meta.url);
const { PrismaClient, SignatureRequestStatus, TaskStatus } =
  require("@prisma/client") as typeof import("@prisma/client");

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().url(),
  STORAGE_DIR: z.string().default("../../storage"),
  QPDF_BIN: z.string().default("qpdf"),
  PDFTOPPM_BIN: z.string().default("pdftoppm"),
  PDF_RENDER_DPI: z.coerce.number().int().min(72).max(300).default(144)
});

const env = EnvSchema.parse(process.env);
const storageRoot = resolve(env.STORAGE_DIR);
const queueName = "pdf-tasks";
const STARTUP_RETRY_ATTEMPTS = 15;
const STARTUP_RETRY_DELAY_MS = 1500;
const WORD_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const POWERPOINT_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const JPEG_MIME_TYPE = "image/jpeg";
const PNG_MIME_TYPE = "image/png";
const EMUS_PER_POINT = 12700;
const TWIPS_PER_POINT = 20;

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

const JpgToPdfPayloadSchema = z.object({
  taskId: z.string(),
  fileKeys: z.array(z.string()).min(1),
  outputName: z.string().min(1)
});

const SplitPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  pageRanges: z.array(z.string()).min(1),
  outputPrefix: z.string().min(1)
});

const RemovePagesPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  pageRanges: z.array(z.string()).min(1),
  outputName: z.string().min(1)
});

const ExtractPagesPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  pageRanges: z.array(z.string()).min(1),
  outputName: z.string().min(1)
});

const OrganizePdfPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  pageOrder: z.array(z.number().int().min(1)).min(1),
  outputName: z.string().min(1)
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

const CompressPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  outputName: z.string().min(1)
});

const ProtectPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  password: z.string().min(1),
  outputName: z.string().min(1)
});

const UnlockPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  password: z.string().min(1),
  outputName: z.string().min(1)
});

const ConvertPayloadSchema = z.object({
  taskId: z.string(),
  fileKey: z.string(),
  outputName: z.string().min(1)
});

const EditTextSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  text: z.string().min(1),
  fontSize: z.number().min(4).max(400),
  fontFamily: z.enum(["sans", "serif", "mono"]),
  bold: z.boolean(),
  italic: z.boolean(),
  underline: z.boolean(),
  color: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/)
});

const EditRectangleSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  color: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/),
  opacity: z.number().min(0).max(1)
});

const EditImageSchema = z.object({
  page: z.number().int().min(1),
  x: z.number().min(0),
  y: z.number().min(0),
  width: z.number().positive(),
  height: z.number().positive(),
  dataUrl: z.string().startsWith("data:image/")
});

const EditPageRotationSchema = z.object({
  page: z.number().int().min(1),
  degrees: z.union([z.literal(90), z.literal(180), z.literal(270)])
});

const EditPageNumbersSchema = z.object({
  startAt: z.number().int().min(1).max(100000),
  fontSize: z.number().min(6).max(72),
  color: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/),
  position: z.enum([
    "top-left",
    "top-center",
    "top-right",
    "bottom-left",
    "bottom-center",
    "bottom-right"
  ]),
  margin: z.number().min(0).max(144),
  prefix: z.string().optional()
});

const EditWatermarkSchema = z.object({
  text: z.string().min(1),
  fontSize: z.number().min(18).max(240),
  color: z.string().regex(/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/),
  opacity: z.number().min(0.05).max(0.95),
  rotation: z.number().min(-180).max(180)
});

const EditPayloadSchema = z
  .object({
    taskId: z.string(),
    fileKey: z.string(),
    textEdits: z.array(EditTextSchema).default([]),
    rectangleEdits: z.array(EditRectangleSchema).default([]),
    imageEdits: z.array(EditImageSchema).default([]),
    pageRotations: z.array(EditPageRotationSchema).default([]),
    pageNumbers: EditPageNumbersSchema.optional(),
    watermark: EditWatermarkSchema.optional(),
    outputName: z.string().min(1),
    expiresAtIso: z.string().datetime().optional()
  })
  .refine(
    (value) =>
      value.textEdits.length +
        value.rectangleEdits.length +
        value.imageEdits.length +
        value.pageRotations.length +
        (value.pageNumbers ? 1 : 0) +
        (value.watermark ? 1 : 0) >
      0,
    {
      message: "At least one edit operation is required."
    }
  );

type MergePayload = z.infer<typeof MergePayloadSchema>;
type JpgToPdfPayload = z.infer<typeof JpgToPdfPayloadSchema>;
type SplitPayload = z.infer<typeof SplitPayloadSchema>;
type RemovePagesPayload = z.infer<typeof RemovePagesPayloadSchema>;
type ExtractPagesPayload = z.infer<typeof ExtractPagesPayloadSchema>;
type OrganizePdfPayload = z.infer<typeof OrganizePdfPayloadSchema>;
type SignPayload = z.infer<typeof SignPayloadSchema>;
type CompressPayload = z.infer<typeof CompressPayloadSchema>;
type ProtectPayload = z.infer<typeof ProtectPayloadSchema>;
type UnlockPayload = z.infer<typeof UnlockPayloadSchema>;
type ConvertPayload = z.infer<typeof ConvertPayloadSchema>;
type EditPayload = z.infer<typeof EditPayloadSchema>;
type ProgressReporter = (percent: number, message: string) => Promise<void>;

function clampProgress(percent: number): number {
  return Math.max(0, Math.min(100, Math.round(percent)));
}
type RenderedPdfPage = {
  pageNumber: number;
  widthPt: number;
  heightPt: number;
  imageBuffer: Buffer;
  imageFileName: string;
};

type RenderedJpegPage = {
  pageNumber: number;
  imageBuffer: Buffer;
  imageFileName: string;
};

function sanitizeFileName(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9_.-]/g, "_").trim();
  return base || `file-${randomUUID()}`;
}

function safeNameWithExtension(name: string, extension: string): string {
  const safe = sanitizeFileName(name);
  return safe.toLowerCase().endsWith(extension.toLowerCase()) ? safe : `${safe}${extension}`;
}

function safePdfName(name: string): string {
  return safeNameWithExtension(name, ".pdf");
}

function safeJpgName(name: string): string {
  return safeNameWithExtension(name, ".jpg");
}

function safeZipName(name: string): string {
  return safeNameWithExtension(name, ".zip");
}

function stripFileExtension(name: string): string {
  const lastDot = name.lastIndexOf(".");
  return lastDot > 0 ? name.slice(0, lastDot) : name;
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

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args);
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const installHint =
          command === env.QPDF_BIN
            ? 'Install qpdf (for macOS: brew install qpdf).'
            : command === env.PDFTOPPM_BIN
              ? 'Install poppler-utils or poppler so "pdftoppm" is available.'
              : `Install the required tool "${command}".`;
        rejectPromise(new Error(`Required tool "${command}" is not installed. ${installHint}`));
        return;
      }

      rejectPromise(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

async function withTempDir<T>(task: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(resolve(tmpdir(), "ihatepdf-"));
  try {
    return await task(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
  fileName: string,
  expiresAt?: Date
): Promise<string> {
  const path = resolveStoragePath(objectKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, body);

  const file = await prisma.fileObject.create({
    data: {
      objectKey,
      fileName,
      mimeType: contentType,
      sizeBytes: BigInt(body.byteLength),
      expiresAt
    }
  });

  return file.id;
}

function createOutputObjectKey(fileName: string): string {
  return `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
}

async function saveOutputFile(fileName: string, contentType: string, body: Buffer): Promise<string> {
  return uploadObject(createOutputObjectKey(fileName), contentType, body, fileName);
}

async function updateTaskProgress(
  taskId: string,
  progressPercent: number,
  progressMessage: string
): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      progressPercent: clampProgress(progressPercent),
      progressMessage
    }
  });
}

async function markProcessing(taskId: string, progressMessage = "Preparing task..."): Promise<void> {
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.processing,
      progressPercent: 5,
      progressMessage
    }
  });
}

async function markFailed(taskId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : "Unknown task error";
  await prisma.task.update({
    where: { id: taskId },
    data: {
      status: TaskStatus.failed,
      errorMessage: message,
      progressMessage: message
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
      errorMessage: null,
      progressPercent: 100,
      progressMessage: "Completed"
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

async function runMerge(payload: MergePayload, reportProgress: ProgressReporter): Promise<string> {
  const merged = await PDFDocument.create();

  for (const [index, key] of payload.fileKeys.entries()) {
    await reportProgress(
      12 + Math.floor((index / payload.fileKeys.length) * 58),
      `Merging file ${index + 1} of ${payload.fileKeys.length}...`
    );
    const sourceBuffer = await downloadObject(key);
    const source = await PDFDocument.load(sourceBuffer);
    const copiedPages = await merged.copyPages(source, source.getPageIndices());
    copiedPages.forEach((page) => merged.addPage(page));
  }

  await reportProgress(82, "Building merged PDF...");
  const outputBuffer = Buffer.from(await merged.save());
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  await reportProgress(96, "Saving merged file...");
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

function expandPageRanges(ranges: string[], totalPages: number): number[] {
  return ranges.flatMap((range) => parseRange(range, totalPages));
}

function uniquePageIndices(pageIndices: number[]): number[] {
  return Array.from(new Set(pageIndices));
}

function parsePageOrder(pageOrder: number[], totalPages: number): number[] {
  return pageOrder.map((pageNumber) => {
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > totalPages) {
      throw new Error(`Invalid page number ${pageNumber}. PDF has ${totalPages} page(s).`);
    }

    return pageNumber - 1;
  });
}

async function createPdfFromPageIndices(source: PDFDocument, pageIndices: number[]): Promise<Buffer> {
  const nextPdf = await PDFDocument.create();
  const copiedPages = await nextPdf.copyPages(source, pageIndices);
  copiedPages.forEach((page) => nextPdf.addPage(page));
  return Buffer.from(await nextPdf.save());
}

async function runSplit(payload: SplitPayload, reportProgress: ProgressReporter): Promise<string> {
  validatePageRanges(payload.pageRanges);

  await reportProgress(12, "Loading source PDF...");
  const sourceBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const chunks = payload.pageRanges.map((range) => ({ range, pages: parseRange(range, totalPages) }));

  if (chunks.length === 1) {
    const only = chunks[0];
    await reportProgress(45, `Extracting pages ${only.range}...`);
    const splitDoc = await PDFDocument.create();
    const copiedPages = await splitDoc.copyPages(source, only.pages);
    copiedPages.forEach((page) => splitDoc.addPage(page));

    await reportProgress(86, "Saving split PDF...");
    const body = Buffer.from(await splitDoc.save());
    const fileName = safePdfName(`${payload.outputPrefix}-${only.range}.pdf`);
    const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
    return uploadObject(objectKey, "application/pdf", body, fileName);
  }

  const zip = new JSZip();
  for (const [index, chunk] of chunks.entries()) {
    await reportProgress(
      25 + Math.floor((index / chunks.length) * 50),
      `Creating split ${index + 1} of ${chunks.length}...`
    );
    const splitDoc = await PDFDocument.create();
    const copiedPages = await splitDoc.copyPages(source, chunk.pages);
    copiedPages.forEach((page) => splitDoc.addPage(page));
    const splitBytes = Buffer.from(await splitDoc.save());
    const fileName = safePdfName(`${payload.outputPrefix}-${chunk.range}.pdf`);
    zip.file(fileName, splitBytes);
  }

  await reportProgress(84, "Packaging split files...");
  const zipData = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = `${payload.outputPrefix}-split.zip`;
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${zipName}`;

  await reportProgress(96, "Saving split archive...");
  return uploadObject(objectKey, "application/zip", zipData, zipName);
}

async function runRemovePages(
  payload: RemovePagesPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  validatePageRanges(payload.pageRanges);

  await reportProgress(12, "Loading source PDF...");
  const sourceBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const removedPages = new Set(expandPageRanges(payload.pageRanges, totalPages));
  const keptPages = Array.from({ length: totalPages }, (_, index) => index).filter(
    (pageIndex) => !removedPages.has(pageIndex)
  );

  if (keptPages.length === 0) {
    throw new Error("Cannot remove every page from the PDF.");
  }

  await reportProgress(48, `Rebuilding PDF with ${keptPages.length} remaining page(s)...`);
  const body = await createPdfFromPageIndices(source, keptPages);
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  await reportProgress(96, "Saving updated PDF...");
  return uploadObject(objectKey, "application/pdf", body, fileName);
}

async function runExtractPages(
  payload: ExtractPagesPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  validatePageRanges(payload.pageRanges);

  await reportProgress(12, "Loading source PDF...");
  const sourceBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const extractedPages = uniquePageIndices(expandPageRanges(payload.pageRanges, totalPages));

  await reportProgress(48, `Extracting ${extractedPages.length} page(s)...`);
  const body = await createPdfFromPageIndices(source, extractedPages);
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  await reportProgress(96, "Saving extracted PDF...");
  return uploadObject(objectKey, "application/pdf", body, fileName);
}

async function runOrganizePdf(
  payload: OrganizePdfPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  await reportProgress(12, "Loading source PDF...");
  const sourceBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(sourceBuffer);
  const totalPages = source.getPageCount();
  const orderedPages = parsePageOrder(payload.pageOrder, totalPages);

  await reportProgress(48, `Reordering ${orderedPages.length} page slot(s)...`);
  const body = await createPdfFromPageIndices(source, orderedPages);
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  await reportProgress(96, "Saving organized PDF...");
  return uploadObject(objectKey, "application/pdf", body, fileName);
}

async function runSign(payload: SignPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(12, "Loading source PDF...");
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
  await reportProgress(58, `Placing signature on page ${payload.page}...`);
  page.drawImage(embeddedImage, {
    x: payload.x,
    y: payload.y,
    width: payload.width,
    height: payload.height
  });

  await reportProgress(86, "Saving signed PDF...");
  const signed = await pdfDoc.save();
  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;

  await reportProgress(96, "Saving signed file...");
  return uploadObject(objectKey, "application/pdf", Buffer.from(signed), fileName);
}

async function runCompress(payload: CompressPayload, reportProgress: ProgressReporter): Promise<string> {
  const inputPath = resolveStoragePath(payload.fileKey);

  await reportProgress(18, "Preparing PDF for compression...");
  const outputBuffer = await withTempDir(async (dir) => {
    const outputPath = resolve(dir, `compressed-${randomUUID()}.pdf`);
    const inputBuffer = await readFile(inputPath);

    await reportProgress(52, "Recompressing PDF streams...");
    await runCommand(env.QPDF_BIN, [
      "--compress-streams=y",
      "--decode-level=generalized",
      "--recompress-flate",
      "--compression-level=9",
      "--object-streams=generate",
      inputPath,
      outputPath
    ]);

    await reportProgress(82, "Finalizing compressed PDF...");
    const optimizedBuffer = await readFile(outputPath);
    return optimizedBuffer.byteLength <= inputBuffer.byteLength ? optimizedBuffer : inputBuffer;
  });

  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  await reportProgress(96, "Saving compressed PDF...");
  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

async function runJpgToPdf(
  payload: JpgToPdfPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  const pdfDoc = await PDFDocument.create();

  for (const [index, key] of payload.fileKeys.entries()) {
    await reportProgress(
      14 + Math.floor((index / payload.fileKeys.length) * 60),
      `Embedding image ${index + 1} of ${payload.fileKeys.length}...`
    );
    const imageBuffer = await downloadObject(key);
    const jpgImage = await pdfDoc.embedJpg(imageBuffer);
    const page = pdfDoc.addPage([jpgImage.width, jpgImage.height]);
    page.drawImage(jpgImage, {
      x: 0,
      y: 0,
      width: jpgImage.width,
      height: jpgImage.height
    });
  }

  await reportProgress(82, "Building PDF from JPG pages...");
  const outputBuffer = Buffer.from(await pdfDoc.save());
  const fileName = safePdfName(payload.outputName);
  await reportProgress(96, "Saving PDF...");
  return saveOutputFile(fileName, "application/pdf", outputBuffer);
}

async function runProtect(payload: ProtectPayload, reportProgress: ProgressReporter): Promise<string> {
  const inputPath = resolveStoragePath(payload.fileKey);

  await reportProgress(18, "Preparing encrypted output...");
  const outputBuffer = await withTempDir(async (dir) => {
    const outputPath = resolve(dir, `protected-${randomUUID()}.pdf`);
    await reportProgress(52, "Encrypting PDF...");
    await runCommand(env.QPDF_BIN, [
      "--encrypt",
      payload.password,
      payload.password,
      "256",
      "--",
      inputPath,
      outputPath
    ]);

    return readFile(outputPath);
  });

  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  await reportProgress(96, "Saving protected PDF...");
  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

async function runUnlock(payload: UnlockPayload, reportProgress: ProgressReporter): Promise<string> {
  const inputPath = resolveStoragePath(payload.fileKey);

  await reportProgress(18, "Preparing decrypted output...");
  const outputBuffer = await withTempDir(async (dir) => {
    const outputPath = resolve(dir, `unlocked-${randomUUID()}.pdf`);
    await reportProgress(52, "Removing PDF password...");
    await runCommand(env.QPDF_BIN, [
      `--password=${payload.password}`,
      "--decrypt",
      inputPath,
      outputPath
    ]);

    return readFile(outputPath);
  });

  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  await reportProgress(96, "Saving unlocked PDF...");
  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

function trimTrailingLineBreaks(buffer: Buffer): Buffer {
  let end = buffer.length;
  while (end > 0 && (buffer[end - 1] === 0x0a || buffer[end - 1] === 0x0d)) {
    end -= 1;
  }
  return buffer.subarray(0, end);
}

function decodeUtf16Be(value: Buffer): string {
  const evenLength = value.length - (value.length % 2);
  const swapped = Buffer.allocUnsafe(evenLength);
  for (let index = 0; index < evenLength; index += 2) {
    swapped[index] = value[index + 1];
    swapped[index + 1] = value[index];
  }
  return swapped.toString("utf16le");
}

function decodePdfHexString(token: string): string {
  const hexBody = token.slice(1, -1).replace(/\s+/g, "");
  if (!hexBody) {
    return "";
  }

  const paddedHex = hexBody.length % 2 === 0 ? hexBody : `${hexBody}0`;
  const value = Buffer.from(paddedHex, "hex");
  if (value.length >= 2 && value[0] === 0xfe && value[1] === 0xff) {
    return decodeUtf16Be(value.subarray(2));
  }

  if (value.length >= 2 && value[0] === 0xff && value[1] === 0xfe) {
    return value.subarray(2).toString("utf16le");
  }

  return value.toString("latin1");
}

function decodePdfLiteralString(token: string): string {
  let output = "";
  for (let index = 1; index < token.length - 1; index += 1) {
    const char = token[index];
    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = token[index + 1];
    if (!next) {
      break;
    }

    if (/[0-7]/.test(next)) {
      let octal = next;
      let cursor = index + 2;
      while (cursor < token.length - 1 && octal.length < 3 && /[0-7]/.test(token[cursor])) {
        octal += token[cursor];
        cursor += 1;
      }
      output += String.fromCharCode(parseInt(octal, 8));
      index = cursor - 1;
      continue;
    }

    index += 1;
    if (next === "n") {
      output += "\n";
      continue;
    }
    if (next === "r") {
      output += "\r";
      continue;
    }
    if (next === "t") {
      output += "\t";
      continue;
    }
    if (next === "b") {
      output += "\b";
      continue;
    }
    if (next === "f") {
      output += "\f";
      continue;
    }
    if (next === "\n" || next === "\r") {
      continue;
    }

    output += next;
  }

  return output;
}

function decodePdfStringToken(token: string): string {
  if (token.startsWith("(") && token.endsWith(")")) {
    return decodePdfLiteralString(token);
  }

  if (token.startsWith("<") && token.endsWith(">")) {
    return decodePdfHexString(token);
  }

  return "";
}

function decodePdfStream(dictionary: string, rawStream: Buffer): Buffer | null {
  const stream = trimTrailingLineBreaks(rawStream);
  if (!dictionary.includes("/Filter")) {
    return stream;
  }

  if (dictionary.includes("/FlateDecode")) {
    try {
      return inflateSync(stream);
    } catch {
      try {
        return inflateRawSync(stream);
      } catch {
        return null;
      }
    }
  }

  return stream;
}

function extractStreamText(content: string): string[] {
  const fragments: string[] = [];
  const textBlocks = content.match(/BT[\s\S]*?ET/g) ?? [];
  const sources = textBlocks.length > 0 ? textBlocks : [content];
  const directTokenRegex = /(\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>)\s*(?:Tj|['"])/g;
  const arrayTokenRegex = /\[((?:\\.|[\s\S])*?)\]\s*TJ/g;
  const stringTokenRegex = /\((?:\\.|[^\\()])*\)|<[\da-fA-F\s]+>/g;

  for (const source of sources) {
    directTokenRegex.lastIndex = 0;
    arrayTokenRegex.lastIndex = 0;
    let directMatch: RegExpExecArray | null = directTokenRegex.exec(source);
    while (directMatch) {
      fragments.push(decodePdfStringToken(directMatch[1]));
      directMatch = directTokenRegex.exec(source);
    }

    let arrayMatch: RegExpExecArray | null = arrayTokenRegex.exec(source);
    while (arrayMatch) {
      const arrayBody = arrayMatch[1];
      stringTokenRegex.lastIndex = 0;
      let tokenMatch: RegExpExecArray | null = stringTokenRegex.exec(arrayBody);
      while (tokenMatch) {
        fragments.push(decodePdfStringToken(tokenMatch[0]));
        tokenMatch = stringTokenRegex.exec(arrayBody);
      }
      arrayMatch = arrayTokenRegex.exec(source);
    }
  }

  return fragments;
}

function uniqueCleanText(values: string[]): string[] {
  const output: string[] = [];
  const seen = new Set<string>();

  for (const raw of values) {
    const normalized = raw
      .replace(/\s+/g, " ")
      .replace(/[^\x09\x20-\x7e]+/g, "")
      .trim();

    if (!normalized || normalized.length < 2 || !/[a-zA-Z0-9]/.test(normalized)) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    output.push(normalized);
    if (output.length >= 600) {
      break;
    }
  }

  return output;
}

function extractPdfTextLines(input: Buffer): string[] {
  const source = input.toString("latin1");
  const objectRegex = /\b\d+\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  const fragments: string[] = [];

  let objectMatch: RegExpExecArray | null = objectRegex.exec(source);
  while (objectMatch) {
    const body = objectMatch[1];
    const streamIndex = body.indexOf("stream");
    const endstreamIndex = streamIndex === -1 ? -1 : body.indexOf("endstream", streamIndex + 6);

    if (streamIndex !== -1 && endstreamIndex !== -1) {
      let streamStart = streamIndex + 6;
      if (body[streamStart] === "\r" && body[streamStart + 1] === "\n") {
        streamStart += 2;
      } else if (body[streamStart] === "\n" || body[streamStart] === "\r") {
        streamStart += 1;
      }

      const dictionary = body.slice(0, streamIndex);
      const rawStream = Buffer.from(body.slice(streamStart, endstreamIndex), "latin1");
      const decoded = decodePdfStream(dictionary, rawStream);
      if (decoded) {
        fragments.push(...extractStreamText(decoded.toString("latin1")));
      }
    }

    objectMatch = objectRegex.exec(source);
  }

  const extracted = uniqueCleanText(fragments);
  if (extracted.length > 0) {
    return extracted;
  }

  const fallback = source.match(/[a-zA-Z0-9][a-zA-Z0-9 .,;:()_/\-]{5,}/g) ?? [];
  return uniqueCleanText(fallback);
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function xmlUnescape(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildCorePropsXml(): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>PDF conversion output</dc:title>
  <dc:creator>iHatePDF</dc:creator>
  <cp:lastModifiedBy>iHatePDF</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

function buildAppPropsXml(application: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${xmlEscape(application)}</Application>
</Properties>`;
}

function pointsToEmu(value: number): number {
  return Math.max(1, Math.round(value * EMUS_PER_POINT));
}

function pointsToTwips(value: number): number {
  return Math.max(1, Math.round(value * TWIPS_PER_POINT));
}

function scaleToFit(
  widthPt: number,
  heightPt: number,
  maxWidthPt: number,
  maxHeightPt: number
): { widthPt: number; heightPt: number } {
  const safeWidth = Math.max(widthPt, 1);
  const safeHeight = Math.max(heightPt, 1);
  const scale = Math.min(maxWidthPt / safeWidth, maxHeightPt / safeHeight, 1);
  return {
    widthPt: safeWidth * scale,
    heightPt: safeHeight * scale
  };
}

function sanitizeSheetName(value: string): string {
  const normalized = value.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (normalized || "Page").slice(0, 31);
}

async function renderPdfPages(inputBuffer: Buffer): Promise<RenderedPdfPage[]> {
  const source = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
  const pageSizes = source.getPages().map((page, index) => ({
    pageNumber: index + 1,
    widthPt: page.getWidth(),
    heightPt: page.getHeight()
  }));

  if (pageSizes.length === 0) {
    throw new Error("The uploaded PDF does not contain any pages.");
  }

  return withTempDir(async (dir) => {
    const inputPath = resolve(dir, "source.pdf");
    const outputPrefix = resolve(dir, "page");
    await writeFile(inputPath, inputBuffer);
    await runCommand(env.PDFTOPPM_BIN, ["-png", "-r", String(env.PDF_RENDER_DPI), inputPath, outputPrefix]);

    const pageFiles = (await readdir(dir))
      .map((fileName) => {
        const match = /^page-(\d+)\.png$/i.exec(fileName);
        return match ? { fileName, pageNumber: Number(match[1]) } : null;
      })
      .filter((value): value is { fileName: string; pageNumber: number } => value !== null)
      .sort((left, right) => left.pageNumber - right.pageNumber);

    if (pageFiles.length !== pageSizes.length) {
      throw new Error(
        `PDF rendering produced ${pageFiles.length} page image(s) for a ${pageSizes.length}-page PDF.`
      );
    }

    return Promise.all(
      pageFiles.map(async ({ fileName, pageNumber }) => {
        const page = pageSizes[pageNumber - 1];
        return {
          pageNumber,
          widthPt: page.widthPt,
          heightPt: page.heightPt,
          imageBuffer: await readFile(resolve(dir, fileName)),
          imageFileName: `page-${pageNumber}.png`
        };
      })
    );
  });
}

async function renderPdfPagesAsJpegs(inputBuffer: Buffer): Promise<RenderedJpegPage[]> {
  const source = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
  const pageCount = source.getPageCount();

  if (pageCount === 0) {
    throw new Error("The uploaded PDF does not contain any pages.");
  }

  return withTempDir(async (dir) => {
    const inputPath = resolve(dir, "source.pdf");
    const outputPrefix = resolve(dir, "page");
    await writeFile(inputPath, inputBuffer);
    await runCommand(env.PDFTOPPM_BIN, [
      "-jpeg",
      "-r",
      String(env.PDF_RENDER_DPI),
      inputPath,
      outputPrefix
    ]);

    const pageFiles = (await readdir(dir))
      .map((fileName) => {
        const match = /^page-(\d+)\.jpg$/i.exec(fileName);
        return match ? { fileName, pageNumber: Number(match[1]) } : null;
      })
      .filter((value): value is { fileName: string; pageNumber: number } => value !== null)
      .sort((left, right) => left.pageNumber - right.pageNumber);

    if (pageFiles.length !== pageCount) {
      throw new Error(
        `PDF rendering produced ${pageFiles.length} image(s) for a ${pageCount}-page PDF.`
      );
    }

    return Promise.all(
      pageFiles.map(async ({ fileName, pageNumber }) => ({
        pageNumber,
        imageBuffer: await readFile(resolve(dir, fileName)),
        imageFileName: `page-${pageNumber}.jpg`
      }))
    );
  });
}

function wordImageParagraphXml(
  relId: string,
  docPrId: number,
  imageName: string,
  widthEmu: number,
  heightEmu: number
): string {
  return `<w:p>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <wp:extent cx="${widthEmu}" cy="${heightEmu}"/>
        <wp:docPr id="${docPrId}" name="${xmlEscape(imageName)}"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks noChangeAspect="1"/>
        </wp:cNvGraphicFramePr>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
              <pic:nvPicPr>
                <pic:cNvPr id="${docPrId}" name="${xmlEscape(imageName)}"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${relId}"/>
                <a:stretch>
                  <a:fillRect/>
                </a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
                </a:xfrm>
                <a:prstGeom prst="rect">
                  <a:avLst/>
                </a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`;
}

async function createDocxFromRenderedPages(pages: RenderedPdfPage[]): Promise<Buffer> {
  const zip = new JSZip();
  const maxWidthPt = Math.max(...pages.map((page) => page.widthPt));
  const maxHeightPt = Math.max(...pages.map((page) => page.heightPt));
  const pageBodyXml = pages
    .map((page, index) => {
      const scaled = scaleToFit(page.widthPt, page.heightPt, maxWidthPt, maxHeightPt);
      const imageParagraph = wordImageParagraphXml(
        `rId${index + 1}`,
        index + 1,
        page.imageFileName,
        pointsToEmu(scaled.widthPt),
        pointsToEmu(scaled.heightPt)
      );
      const pageBreak = index < pages.length - 1 ? `<w:p><w:r><w:br w:type="page"/></w:r></w:p>` : "";
      return `${imageParagraph}${pageBreak}`;
    })
    .join("");

  const imageRelationships = pages
    .map(
      (page, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${page.imageFileName}"/>`
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="${PNG_MIME_TYPE}"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    ${pageBodyXml}
    <w:sectPr>
      <w:pgSz w:w="${pointsToTwips(maxWidthPt)}" w:h="${pointsToTwips(maxHeightPt)}"/>
      <w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${imageRelationships}
</Relationships>`
  );

  for (const page of pages) {
    zip.file(`word/media/${page.imageFileName}`, page.imageBuffer);
  }

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF Word Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function slideImageXml(
  relId: string,
  imageName: string,
  pageNumber: number,
  xEmu: number,
  yEmu: number,
  widthEmu: number,
  heightEmu: number
): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="${xmlEscape(`Page ${pageNumber}`)}"/>
          <p:cNvPicPr/>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="${relId}"/>
          <a:stretch>
            <a:fillRect/>
          </a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="${xEmu}" y="${yEmu}"/>
            <a:ext cx="${widthEmu}" cy="${heightEmu}"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`;
}

async function createPptxFromRenderedPages(pages: RenderedPdfPage[]): Promise<Buffer> {
  const zip = new JSZip();
  const maxWidthPt = Math.max(...pages.map((page) => page.widthPt));
  const maxHeightPt = Math.max(...pages.map((page) => page.heightPt));
  const slideOverrides = pages
    .map(
      (page) =>
        `<Override PartName="/ppt/slides/slide${page.pageNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("");

  const slideIdXml = pages
    .map(
      (page, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`
    )
    .join("");

  const slideRelXml = pages
    .map(
      (page, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${page.pageNumber}.xml"/>`
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="${PNG_MIME_TYPE}"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${slideIdXml}
  </p:sldIdLst>
  <p:sldSz cx="${pointsToEmu(maxWidthPt)}" cy="${pointsToEmu(maxHeightPt)}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`
  );

  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideRelXml}
</Relationships>`
  );

  for (const page of pages) {
    const scaled = scaleToFit(page.widthPt, page.heightPt, maxWidthPt, maxHeightPt);
    const xPt = (maxWidthPt - scaled.widthPt) / 2;
    const yPt = (maxHeightPt - scaled.heightPt) / 2;
    zip.file(
      `ppt/slides/slide${page.pageNumber}.xml`,
      slideImageXml(
        "rId1",
        page.imageFileName,
        page.pageNumber,
        pointsToEmu(xPt),
        pointsToEmu(yPt),
        pointsToEmu(scaled.widthPt),
        pointsToEmu(scaled.heightPt)
      )
    );
    zip.file(
      `ppt/slides/_rels/slide${page.pageNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${page.imageFileName}"/>
</Relationships>`
    );
    zip.file(`ppt/media/${page.imageFileName}`, page.imageBuffer);
  }

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF PowerPoint Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createXlsxFromRenderedPages(pages: RenderedPdfPage[]): Promise<Buffer> {
  const zip = new JSZip();
  const worksheetOverrides = pages
    .map(
      (page) =>
        `<Override PartName="/xl/worksheets/sheet${page.pageNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
    )
    .join("");
  const drawingOverrides = pages
    .map(
      (page) =>
        `<Override PartName="/xl/drawings/drawing${page.pageNumber}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`
    )
    .join("");
  const sheetsXml = pages
    .map(
      (page) =>
        `<sheet name="${xmlEscape(sanitizeSheetName(`Page ${page.pageNumber}`))}" sheetId="${page.pageNumber}" r:id="rId${page.pageNumber}"/>`
    )
    .join("");
  const workbookRelsXml = pages
    .map(
      (page) =>
        `<Relationship Id="rId${page.pageNumber}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${page.pageNumber}.xml"/>`
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="${PNG_MIME_TYPE}"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${worksheetOverrides}
  ${drawingOverrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews>
    <workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000"/>
  </bookViews>
  <sheets>
    ${sheetsXml}
  </sheets>
</workbook>`
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelsXml}
</Relationships>`
  );

  for (const page of pages) {
    zip.file(
      `xl/worksheets/sheet${page.pageNumber}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <dimension ref="A1"/>
  <sheetViews>
    <sheetView workbookViewId="0"/>
  </sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  <sheetData/>
  <pageMargins left="0.2" right="0.2" top="0.2" bottom="0.2" header="0" footer="0"/>
  <drawing r:id="rId1"/>
</worksheet>`
    );
    zip.file(
      `xl/worksheets/_rels/sheet${page.pageNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${page.pageNumber}.xml"/>
</Relationships>`
    );
    zip.file(
      `xl/drawings/drawing${page.pageNumber}.xml`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <xdr:oneCellAnchor>
    <xdr:from>
      <xdr:col>0</xdr:col>
      <xdr:colOff>0</xdr:colOff>
      <xdr:row>0</xdr:row>
      <xdr:rowOff>0</xdr:rowOff>
    </xdr:from>
    <xdr:ext cx="${pointsToEmu(page.widthPt)}" cy="${pointsToEmu(page.heightPt)}"/>
    <xdr:pic>
      <xdr:nvPicPr>
        <xdr:cNvPr id="${page.pageNumber}" name="${xmlEscape(page.imageFileName)}"/>
        <xdr:cNvPicPr/>
      </xdr:nvPicPr>
      <xdr:blipFill>
        <a:blip r:embed="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/>
        <a:stretch>
          <a:fillRect/>
        </a:stretch>
      </xdr:blipFill>
      <xdr:spPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${pointsToEmu(page.widthPt)}" cy="${pointsToEmu(page.heightPt)}"/>
        </a:xfrm>
        <a:prstGeom prst="rect">
          <a:avLst/>
        </a:prstGeom>
      </xdr:spPr>
    </xdr:pic>
    <xdr:clientData/>
  </xdr:oneCellAnchor>
</xdr:wsDr>`
    );
    zip.file(
      `xl/drawings/_rels/drawing${page.pageNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${page.imageFileName}"/>
</Relationships>`
    );
    zip.file(`xl/media/${page.imageFileName}`, page.imageBuffer);
  }

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF Excel Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function createDocxBuffer(textLines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const lines = textLines.length > 0 ? textLines : ["No extractable text was found in this PDF."];
  const paragraphs = lines
    .slice(0, 1200)
    .map(
      (line) =>
        `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(line)}</w:t></w:r></w:p>`
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${paragraphs}
    <w:sectPr>
      <w:pgSz w:w="12240" w:h="15840"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`
  );

  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`
  );

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF Word Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function toExcelColumnName(index: number): string {
  let value = index + 1;
  let output = "";
  while (value > 0) {
    const mod = (value - 1) % 26;
    output = `${String.fromCharCode(65 + mod)}${output}`;
    value = Math.floor((value - 1) / 26);
  }
  return output;
}

function splitLineIntoColumns(value: string): string[] {
  if (value.includes("\t")) {
    return value.split("\t").map((item) => item.trim()).filter(Boolean);
  }

  if (value.includes(",")) {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }

  if (value.includes(";")) {
    return value.split(";").map((item) => item.trim()).filter(Boolean);
  }

  if (value.includes("|")) {
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  }

  return [value];
}

async function createXlsxBuffer(textLines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const lines = textLines.length > 0 ? textLines.slice(0, 600) : ["No extractable text was found in this PDF."];
  const parsedRows = lines.map(splitLineIntoColumns);
  const detectedColumns = Math.max(1, ...parsedRows.map((row) => row.length));
  const maxColumns = Math.min(8, detectedColumns);
  const headerRow =
    maxColumns === 1
      ? ["Extracted text"]
      : Array.from({ length: maxColumns }, (_, index) => `Column ${index + 1}`);

  const rows = [headerRow, ...parsedRows.map((row) => row.slice(0, maxColumns))];
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${toExcelColumnName(columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "xl/workbook.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Extracted Data" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
  );

  zip.file(
    "xl/_rels/workbook.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`
  );

  zip.file(
    "xl/worksheets/sheet1.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rowXml}
  </sheetData>
</worksheet>`
  );

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF Excel Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function slideXml(index: number, lines: string[]): string {
  const title = `PDF Slide ${index}`;
  const paragraphXml = lines
    .map(
      (line) =>
        `<a:p><a:r><a:rPr lang="en-US" sz="1800"/><a:t>${xmlEscape(line)}</a:t></a:r><a:endParaRPr lang="en-US" sz="1800"/></a:p>`
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="2" name="Title"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="457200" y="274638"/>
            <a:ext cx="8229600" cy="914400"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p>
            <a:r>
              <a:rPr lang="en-US" sz="3200" b="1"/>
              <a:t>${xmlEscape(title)}</a:t>
            </a:r>
            <a:endParaRPr lang="en-US" sz="3200"/>
          </a:p>
        </p:txBody>
      </p:sp>
      <p:sp>
        <p:nvSpPr>
          <p:cNvPr id="3" name="Content"/>
          <p:cNvSpPr/>
          <p:nvPr/>
        </p:nvSpPr>
        <p:spPr>
          <a:xfrm>
            <a:off x="457200" y="1287788"/>
            <a:ext cx="8229600" cy="4937760"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
        <p:txBody>
          <a:bodyPr wrap="square"/>
          <a:lstStyle/>
          ${paragraphXml}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`;
}

async function createPptxBuffer(textLines: string[]): Promise<Buffer> {
  const zip = new JSZip();
  const lines = textLines.length > 0 ? textLines.slice(0, 320) : ["No extractable text was found in this PDF."];
  const slides = chunk(lines, 12).slice(0, 25);
  if (slides.length === 0) {
    slides.push(["No extractable text was found in this PDF."]);
  }

  const slideOverrides = slides
    .map(
      (_, index) =>
        `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`
    )
    .join("");

  const slideIdXml = slides
    .map(
      (_, index) =>
        `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`
    )
    .join("");

  const slideRelXml = slides
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`
    )
    .join("");

  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${slideOverrides}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  );

  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
  );

  zip.file(
    "ppt/presentation.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>
    ${slideIdXml}
  </p:sldIdLst>
  <p:sldSz cx="9144000" cy="6858000" type="screen4x3"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`
  );

  zip.file(
    "ppt/_rels/presentation.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slideRelXml}
</Relationships>`
  );

  for (let index = 0; index < slides.length; index += 1) {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(index + 1, slides[index]));
  }

  zip.file("docProps/core.xml", buildCorePropsXml());
  zip.file("docProps/app.xml", buildAppPropsXml("iHatePDF PowerPoint Export"));

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

async function loadOpenXmlZip(inputBuffer: Buffer, label: string): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(inputBuffer);
  } catch {
    throw new Error(`Unsupported file format. Upload a valid ${label} file.`);
  }
}

function extractXmlTextTokens(content: string, tagName: string): string[] {
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, "g");
  const output: string[] = [];
  let match: RegExpExecArray | null = regex.exec(content);
  while (match) {
    const normalized = xmlUnescape(match[1]).replace(/\s+/g, " ").trim();
    if (normalized) {
      output.push(normalized);
    }
    match = regex.exec(content);
  }
  return output;
}

function excelColumnToIndex(column: string): number {
  let value = 0;
  for (const char of column.toUpperCase()) {
    if (char < "A" || char > "Z") {
      continue;
    }
    value = value * 26 + (char.charCodeAt(0) - 64);
  }
  return Math.max(0, value - 1);
}

async function readXlsxSharedStrings(zip: JSZip): Promise<string[]> {
  const sharedStringsFile = zip.file("xl/sharedStrings.xml");
  if (!sharedStringsFile) {
    return [];
  }

  const sharedStringsXml = await sharedStringsFile.async("string");
  const stringItems = sharedStringsXml.match(/<si\b[\s\S]*?<\/si>/g) ?? [];
  return stringItems.map((item) => extractXmlTextTokens(item, "t").join(" ").trim());
}

function extractXlsxCellValue(cellAttributes: string, cellBody: string, sharedStrings: string[]): string {
  const type = cellAttributes.match(/\bt="([^"]+)"/)?.[1] ?? "";

  if (type === "inlineStr") {
    return extractXmlTextTokens(cellBody, "t").join(" ").trim();
  }

  if (type === "s") {
    const sharedIndex = Number(cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "-1");
    if (Number.isInteger(sharedIndex) && sharedIndex >= 0 && sharedIndex < sharedStrings.length) {
      return sharedStrings[sharedIndex];
    }
    return "";
  }

  const scalarValue = cellBody.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (scalarValue) {
    return xmlUnescape(scalarValue).replace(/\s+/g, " ").trim();
  }

  return extractXmlTextTokens(cellBody, "t").join(" ").trim();
}

function extractXlsxRowValues(rowXml: string, sharedStrings: string[]): string[] {
  const valuesByColumn = new Map<number, string>();
  const cellRegex = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/g;
  let nextColumn = 0;
  let cellMatch: RegExpExecArray | null = cellRegex.exec(rowXml);

  while (cellMatch) {
    const attributes = cellMatch[1] ?? cellMatch[3] ?? "";
    const cellBody = cellMatch[2] ?? "";
    const ref = attributes.match(/\br="([A-Z]+)\d+"/i)?.[1];
    const column = ref ? excelColumnToIndex(ref) : nextColumn;
    nextColumn = Math.max(nextColumn, column + 1);

    const value = extractXlsxCellValue(attributes, cellBody, sharedStrings);
    if (value) {
      valuesByColumn.set(column, value);
    }

    cellMatch = cellRegex.exec(rowXml);
  }

  if (valuesByColumn.size === 0) {
    return [];
  }

  const maxColumn = Math.max(...Array.from(valuesByColumn.keys()));
  const row = Array.from({ length: maxColumn + 1 }, (_, index) => valuesByColumn.get(index) ?? "");
  while (row.length > 0 && row[row.length - 1] === "") {
    row.pop();
  }
  return row.filter(Boolean);
}

async function extractXlsxTextLines(inputBuffer: Buffer): Promise<string[]> {
  const zip = await loadOpenXmlZip(inputBuffer, "Excel (.xlsx)");
  const sharedStrings = await readXlsxSharedStrings(zip);
  const worksheetPaths = Object.keys(zip.files)
    .filter((path) => /^xl\/worksheets\/[^/]+\.xml$/.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const rows: string[] = [];

  for (const worksheetPath of worksheetPaths) {
    const worksheet = zip.file(worksheetPath);
    if (!worksheet) {
      continue;
    }

    const worksheetXml = await worksheet.async("string");
    const rowMatches = worksheetXml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];

    for (const rowXml of rowMatches) {
      const rowValues = extractXlsxRowValues(rowXml, sharedStrings);
      if (rowValues.length > 0) {
        rows.push(rowValues.join("\t"));
      }

      if (rows.length >= 2200) {
        return uniqueCleanText(rows);
      }
    }
  }

  return uniqueCleanText(rows);
}

async function extractPptxTextLines(inputBuffer: Buffer): Promise<string[]> {
  const zip = await loadOpenXmlZip(inputBuffer, "PowerPoint (.pptx)");
  const slidePaths = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

  const lines: string[] = [];

  for (let index = 0; index < slidePaths.length; index += 1) {
    const slide = zip.file(slidePaths[index]);
    if (!slide) {
      continue;
    }

    const slideXml = await slide.async("string");
    const paragraphs = slideXml.match(/<a:p\b[\s\S]*?<\/a:p>/g) ?? [];
    const paragraphLines = paragraphs
      .map((paragraph) => extractXmlTextTokens(paragraph, "a:t").join(" ").trim())
      .filter((paragraph) => paragraph.length > 0);

    if (paragraphLines.length === 0) {
      continue;
    }

    lines.push(`Slide ${index + 1}`);
    lines.push(...paragraphLines);
    if (lines.length >= 2200) {
      return uniqueCleanText(lines);
    }
  }

  return uniqueCleanText(lines);
}

async function extractDocxTextLines(inputBuffer: Buffer): Promise<string[]> {
  const zip = await loadOpenXmlZip(inputBuffer, "Word (.docx)");
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new Error("Unsupported file format. Upload a valid Word (.docx) file.");
  }

  const documentXml = await documentFile.async("string");
  const paragraphMatches = documentXml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  const lines: string[] = [];

  for (const paragraph of paragraphMatches) {
    const text = extractXmlTextTokens(paragraph, "w:t").join(" ").trim();
    if (text) {
      lines.push(text);
    }

    if (lines.length >= 2200) {
      return uniqueCleanText(lines);
    }
  }

  return uniqueCleanText(lines);
}

function wrapTextLine(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) {
    return [value];
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [value.slice(0, maxLength)];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxLength) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
    }

    if (word.length > maxLength) {
      lines.push(word.slice(0, maxLength));
      current = word.slice(maxLength);
      continue;
    }

    current = word;
  }

  if (current) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [value.slice(0, maxLength)];
}

async function createTextPdfBuffer(textLines: string[]): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 48;
  const fontSize = 11;
  const lineHeight = 15;
  const maxWidth = pageWidth - margin * 2;
  const lines = textLines.length > 0 ? textLines.slice(0, 2400) : ["No extractable text was found."];

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  for (const rawLine of lines) {
    const normalizedLine = rawLine.replace(/\s+/g, " ").trim();
    if (!normalizedLine) {
      continue;
    }

    const wrappedLines = wrapTextLine(normalizedLine, 100);
    for (const line of wrappedLines) {
      let output = line;
      while (font.widthOfTextAtSize(output, fontSize) > maxWidth && output.length > 1) {
        output = output.slice(0, -1);
      }

      if (y < margin + lineHeight) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }

      page.drawText(output, {
        x: margin,
        y,
        size: fontSize,
        font,
        color: rgb(0, 0, 0)
      });
      y -= lineHeight;
    }
  }

  return Buffer.from(await pdfDoc.save());
}

function parseHexColor(value: string): { red: number; green: number; blue: number } {
  const raw = value.replace("#", "");
  const hex =
    raw.length === 3
      ? `${raw[0]}${raw[0]}${raw[1]}${raw[1]}${raw[2]}${raw[2]}`
      : raw.padEnd(6, "0").slice(0, 6);

  return {
    red: parseInt(hex.slice(0, 2), 16),
    green: parseInt(hex.slice(2, 4), 16),
    blue: parseInt(hex.slice(4, 6), 16)
  };
}

function resolveStandardFont(textEdit: EditPayload["textEdits"][number]): StandardFonts {
  if (textEdit.fontFamily === "serif") {
    if (textEdit.bold && textEdit.italic) {
      return StandardFonts.TimesRomanBoldItalic;
    }
    if (textEdit.bold) {
      return StandardFonts.TimesRomanBold;
    }
    if (textEdit.italic) {
      return StandardFonts.TimesRomanItalic;
    }
    return StandardFonts.TimesRoman;
  }

  if (textEdit.fontFamily === "mono") {
    if (textEdit.bold && textEdit.italic) {
      return StandardFonts.CourierBoldOblique;
    }
    if (textEdit.bold) {
      return StandardFonts.CourierBold;
    }
    if (textEdit.italic) {
      return StandardFonts.CourierOblique;
    }
    return StandardFonts.Courier;
  }

  if (textEdit.bold && textEdit.italic) {
    return StandardFonts.HelveticaBoldOblique;
  }
  if (textEdit.bold) {
    return StandardFonts.HelveticaBold;
  }
  if (textEdit.italic) {
    return StandardFonts.HelveticaOblique;
  }
  return StandardFonts.Helvetica;
}

function resolveTextAnchorPosition(options: {
  pageWidth: number;
  pageHeight: number;
  textWidth: number;
  fontSize: number;
  margin: number;
  position: NonNullable<EditPayload["pageNumbers"]>["position"];
}): { x: number; y: number } {
  const { pageWidth, pageHeight, textWidth, fontSize, margin, position } = options;
  const isTop = position.startsWith("top");
  const isLeft = position.endsWith("left");
  const isRight = position.endsWith("right");

  let x = (pageWidth - textWidth) / 2;
  if (isLeft) {
    x = margin;
  } else if (isRight) {
    x = pageWidth - margin - textWidth;
  }

  const y = isTop ? pageHeight - margin - fontSize : margin;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}

async function runPdfToWord(payload: ConvertPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(14, "Rendering PDF pages...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const renderedPages = await renderPdfPages(inputBuffer);
  await reportProgress(64, `Building Word document from ${renderedPages.length} page(s)...`);
  const docxBuffer = await createDocxFromRenderedPages(renderedPages);
  const fileName = safeNameWithExtension(payload.outputName, ".docx");
  await reportProgress(96, "Saving Word document...");
  return saveOutputFile(fileName, WORD_MIME_TYPE, docxBuffer);
}

async function runPdfToJpg(payload: ConvertPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(14, "Rendering PDF pages to JPG...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const renderedPages = await renderPdfPagesAsJpegs(inputBuffer);

  if (renderedPages.length === 1) {
    const fileName = safeJpgName(payload.outputName);
    await reportProgress(96, "Saving JPG image...");
    return saveOutputFile(fileName, JPEG_MIME_TYPE, renderedPages[0].imageBuffer);
  }

  const zip = new JSZip();
  const archivePrefix = stripFileExtension(payload.outputName) || "images";

  for (const page of renderedPages) {
    zip.file(`${sanitizeFileName(archivePrefix)}-page-${page.pageNumber}.jpg`, page.imageBuffer);
  }

  await reportProgress(68, `Packaging ${renderedPages.length} JPG pages...`);
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const zipName = safeZipName(`${archivePrefix}-images`);
  await reportProgress(96, "Saving JPG archive...");
  return saveOutputFile(zipName, "application/zip", zipBuffer);
}

async function runPdfToPowerpoint(
  payload: ConvertPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  await reportProgress(14, "Rendering PDF pages...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const renderedPages = await renderPdfPages(inputBuffer);
  await reportProgress(64, `Building PowerPoint deck from ${renderedPages.length} page(s)...`);
  const pptxBuffer = await createPptxFromRenderedPages(renderedPages);
  const fileName = safeNameWithExtension(payload.outputName, ".pptx");
  await reportProgress(96, "Saving PowerPoint file...");
  return saveOutputFile(fileName, POWERPOINT_MIME_TYPE, pptxBuffer);
}

async function runPdfToExcel(payload: ConvertPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(14, "Rendering PDF pages...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const renderedPages = await renderPdfPages(inputBuffer);
  await reportProgress(64, `Building Excel workbook from ${renderedPages.length} page(s)...`);
  const xlsxBuffer = await createXlsxFromRenderedPages(renderedPages);
  const fileName = safeNameWithExtension(payload.outputName, ".xlsx");
  await reportProgress(96, "Saving Excel workbook...");
  return saveOutputFile(fileName, EXCEL_MIME_TYPE, xlsxBuffer);
}

async function runExcelToPdf(payload: ConvertPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(14, "Reading workbook...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const lines = await extractXlsxTextLines(inputBuffer);
  await reportProgress(62, `Formatting ${lines.length} extracted row(s)...`);
  const pdfBuffer = await createTextPdfBuffer(lines);
  const fileName = safePdfName(payload.outputName);
  await reportProgress(96, "Saving PDF...");
  return saveOutputFile(fileName, "application/pdf", pdfBuffer);
}

async function runPowerpointToPdf(
  payload: ConvertPayload,
  reportProgress: ProgressReporter
): Promise<string> {
  await reportProgress(14, "Reading presentation...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const lines = await extractPptxTextLines(inputBuffer);
  await reportProgress(62, `Formatting ${lines.length} extracted text line(s)...`);
  const pdfBuffer = await createTextPdfBuffer(lines);
  const fileName = safePdfName(payload.outputName);
  await reportProgress(96, "Saving PDF...");
  return saveOutputFile(fileName, "application/pdf", pdfBuffer);
}

async function runWordToPdf(payload: ConvertPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(14, "Reading Word document...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const lines = await extractDocxTextLines(inputBuffer);
  await reportProgress(62, `Formatting ${lines.length} extracted text line(s)...`);
  const pdfBuffer = await createTextPdfBuffer(lines);
  const fileName = safePdfName(payload.outputName);
  await reportProgress(96, "Saving PDF...");
  return saveOutputFile(fileName, "application/pdf", pdfBuffer);
}

async function runEdit(payload: EditPayload, reportProgress: ProgressReporter): Promise<string> {
  await reportProgress(12, "Loading source PDF...");
  const inputBuffer = await downloadObject(payload.fileKey);
  const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const embeddedFonts = new Map<StandardFonts, Awaited<ReturnType<typeof pdfDoc.embedFont>>>();
  const totalEdits =
    payload.textEdits.length +
    payload.rectangleEdits.length +
    payload.imageEdits.length +
    payload.pageRotations.length +
    (payload.pageNumbers ? 1 : 0) +
    (payload.watermark ? 1 : 0);
  let completedEdits = 0;

  const advanceEditProgress = async (message: string): Promise<void> => {
    completedEdits += 1;
    await reportProgress(
      22 + Math.floor((completedEdits / Math.max(1, totalEdits)) * 56),
      message
    );
  };

  const pageAt = (pageNumber: number) => {
    if (pageNumber > pages.length) {
      throw new Error(`Invalid page number ${pageNumber}. PDF has ${pages.length} page(s).`);
    }
    return pages[pageNumber - 1];
  };

  const getEmbeddedFont = async (fontName: StandardFonts) => {
    let font = embeddedFonts.get(fontName);
    if (!font) {
      font = await pdfDoc.embedFont(fontName);
      embeddedFonts.set(fontName, font);
    }
    return font;
  };

  for (const item of payload.textEdits) {
    const page = pageAt(item.page);
    const color = parseHexColor(item.color);
    const fontName = resolveStandardFont(item);
    const font = await getEmbeddedFont(fontName);

    page.drawText(item.text, {
      x: item.x,
      y: item.y,
      size: item.fontSize,
      font,
      color: rgb(color.red / 255, color.green / 255, color.blue / 255)
    });

    if (item.underline) {
      const width = font.widthOfTextAtSize(item.text, item.fontSize);
      const thickness = Math.max(0.75, item.fontSize * 0.06);
      page.drawLine({
        start: { x: item.x, y: item.y - thickness * 2.2 },
        end: { x: item.x + width, y: item.y - thickness * 2.2 },
        thickness,
        color: rgb(color.red / 255, color.green / 255, color.blue / 255)
      });
    }

    await advanceEditProgress(`Applying text edit ${completedEdits + 1} of ${totalEdits}...`);
  }

  for (const item of payload.rectangleEdits) {
    const page = pageAt(item.page);
    const color = parseHexColor(item.color);
    page.drawRectangle({
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      color: rgb(color.red / 255, color.green / 255, color.blue / 255),
      opacity: item.opacity
    });

    await advanceEditProgress(`Applying shape edit ${completedEdits + 1} of ${totalEdits}...`);
  }

  for (const item of payload.imageEdits) {
    const page = pageAt(item.page);
    const imageData = parseDataUrl(item.dataUrl);
    const embeddedImage = isJpegDataUrl(item.dataUrl)
      ? await pdfDoc.embedJpg(imageData)
      : await pdfDoc.embedPng(imageData);
    page.drawImage(embeddedImage, {
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height
    });

    await advanceEditProgress(`Applying image edit ${completedEdits + 1} of ${totalEdits}...`);
  }

  if (payload.watermark) {
    const font = await getEmbeddedFont(StandardFonts.HelveticaBold);
    const color = parseHexColor(payload.watermark.color);

    for (const page of pages) {
      const { width, height } = page.getSize();
      const textWidth = font.widthOfTextAtSize(payload.watermark.text, payload.watermark.fontSize);
      page.drawText(payload.watermark.text, {
        x: Math.max(0, (width - textWidth) / 2),
        y: Math.max(0, (height - payload.watermark.fontSize) / 2),
        size: payload.watermark.fontSize,
        font,
        color: rgb(color.red / 255, color.green / 255, color.blue / 255),
        opacity: payload.watermark.opacity,
        rotate: degrees(payload.watermark.rotation)
      });
    }

    await advanceEditProgress(`Applying watermark ${completedEdits + 1} of ${totalEdits}...`);
  }

  if (payload.pageNumbers) {
    const font = await getEmbeddedFont(StandardFonts.HelveticaBold);
    const color = parseHexColor(payload.pageNumbers.color);

    pages.forEach((page, index) => {
      const label = `${payload.pageNumbers?.prefix ?? ""}${payload.pageNumbers!.startAt + index}`;
      const textWidth = font.widthOfTextAtSize(label, payload.pageNumbers!.fontSize);
      const { width, height } = page.getSize();
      const point = resolveTextAnchorPosition({
        pageWidth: width,
        pageHeight: height,
        textWidth,
        fontSize: payload.pageNumbers!.fontSize,
        margin: payload.pageNumbers!.margin,
        position: payload.pageNumbers!.position
      });

      page.drawText(label, {
        x: point.x,
        y: point.y,
        size: payload.pageNumbers!.fontSize,
        font,
        color: rgb(color.red / 255, color.green / 255, color.blue / 255)
      });
    });

    await advanceEditProgress(`Adding page numbers ${completedEdits + 1} of ${totalEdits}...`);
  }

  for (const item of payload.pageRotations) {
    const page = pageAt(item.page);
    const nextAngle = (page.getRotation().angle + item.degrees) % 360;
    page.setRotation(degrees(nextAngle));
    await advanceEditProgress(`Rotating page ${item.page} (${completedEdits + 1} of ${totalEdits})...`);
  }

  await reportProgress(86, "Saving edited PDF...");
  const editedBuffer = Buffer.from(await pdfDoc.save());
  const fileName = safePdfName(payload.outputName);
  await reportProgress(96, "Saving edited file...");
  return uploadObject(
    createOutputObjectKey(fileName),
    "application/pdf",
    editedBuffer,
    fileName,
    payload.expiresAtIso ? new Date(payload.expiresAtIso) : undefined
  );
}

async function processJob(job: Job): Promise<void> {
  const { name, data } = job;

  const runTask = async <TPayload>(
    taskId: string,
    initialMessage: string,
    task: (reportProgress: ProgressReporter) => Promise<string>
  ): Promise<void> => {
    await markProcessing(taskId, initialMessage);
    const reportProgress: ProgressReporter = (percent, message) =>
      updateTaskProgress(taskId, percent, message);
    const outputFileId = await task(reportProgress);
    await markCompleted(taskId, outputFileId);
  };

  if (name === "merge") {
    const payload = MergePayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing merge...", (reportProgress) =>
      runMerge(payload, reportProgress)
    );
    return;
  }

  if (name === "jpg-to-pdf") {
    const payload = JpgToPdfPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing JPG to PDF conversion...", (reportProgress) =>
      runJpgToPdf(payload, reportProgress)
    );
    return;
  }

  if (name === "split") {
    const payload = SplitPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing split...", (reportProgress) =>
      runSplit(payload, reportProgress)
    );
    return;
  }

  if (name === "remove-pages") {
    const payload = RemovePagesPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing page removal...", (reportProgress) =>
      runRemovePages(payload, reportProgress)
    );
    return;
  }

  if (name === "extract-pages") {
    const payload = ExtractPagesPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing page extraction...", (reportProgress) =>
      runExtractPages(payload, reportProgress)
    );
    return;
  }

  if (name === "organize-pdf") {
    const payload = OrganizePdfPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing page organization...", (reportProgress) =>
      runOrganizePdf(payload, reportProgress)
    );
    return;
  }

  if (name === "sign") {
    const payload = SignPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing signature...", (reportProgress) =>
      runSign(payload, reportProgress)
    );
    return;
  }

  if (name === "compress") {
    const payload = CompressPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing compression...", (reportProgress) =>
      runCompress(payload, reportProgress)
    );
    return;
  }

  if (name === "protect") {
    const payload = ProtectPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing protection...", (reportProgress) =>
      runProtect(payload, reportProgress)
    );
    return;
  }

  if (name === "unlock") {
    const payload = UnlockPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing unlock...", (reportProgress) =>
      runUnlock(payload, reportProgress)
    );
    return;
  }

  if (name === "pdf-to-word") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing Word conversion...", (reportProgress) =>
      runPdfToWord(payload, reportProgress)
    );
    return;
  }

  if (name === "pdf-to-jpg") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing JPG conversion...", (reportProgress) =>
      runPdfToJpg(payload, reportProgress)
    );
    return;
  }

  if (name === "pdf-to-powerpoint") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing PowerPoint conversion...", (reportProgress) =>
      runPdfToPowerpoint(payload, reportProgress)
    );
    return;
  }

  if (name === "pdf-to-excel") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing Excel conversion...", (reportProgress) =>
      runPdfToExcel(payload, reportProgress)
    );
    return;
  }

  if (name === "word-to-pdf") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing PDF conversion...", (reportProgress) =>
      runWordToPdf(payload, reportProgress)
    );
    return;
  }

  if (name === "excel-to-pdf") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing PDF conversion...", (reportProgress) =>
      runExcelToPdf(payload, reportProgress)
    );
    return;
  }

  if (name === "powerpoint-to-pdf") {
    const payload = ConvertPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing PDF conversion...", (reportProgress) =>
      runPowerpointToPdf(payload, reportProgress)
    );
    return;
  }

  if (name === "edit") {
    const payload = EditPayloadSchema.parse(data);
    await runTask(payload.taskId, "Preparing editor changes...", (reportProgress) =>
      runEdit(payload, reportProgress)
    );
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
