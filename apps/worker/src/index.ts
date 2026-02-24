import "dotenv/config";
import { Job, Worker } from "bullmq";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  QPDF_BIN: z.string().default("qpdf")
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

const EditPayloadSchema = z
  .object({
    taskId: z.string(),
    fileKey: z.string(),
    textEdits: z.array(EditTextSchema).default([]),
    rectangleEdits: z.array(EditRectangleSchema).default([]),
    imageEdits: z.array(EditImageSchema).default([]),
    outputName: z.string().min(1)
  })
  .refine(
    (value) => value.textEdits.length + value.rectangleEdits.length + value.imageEdits.length > 0,
    {
      message: "At least one edit operation is required."
    }
  );

type MergePayload = z.infer<typeof MergePayloadSchema>;
type SplitPayload = z.infer<typeof SplitPayloadSchema>;
type SignPayload = z.infer<typeof SignPayloadSchema>;
type CompressPayload = z.infer<typeof CompressPayloadSchema>;
type ProtectPayload = z.infer<typeof ProtectPayloadSchema>;
type UnlockPayload = z.infer<typeof UnlockPayloadSchema>;
type ConvertPayload = z.infer<typeof ConvertPayloadSchema>;
type EditPayload = z.infer<typeof EditPayloadSchema>;

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
        rejectPromise(
          new Error(
            `Required tool "${command}" is not installed. Install qpdf (for macOS: brew install qpdf).`
          )
        );
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

function createOutputObjectKey(fileName: string): string {
  return `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
}

async function saveOutputFile(fileName: string, contentType: string, body: Buffer): Promise<string> {
  return uploadObject(createOutputObjectKey(fileName), contentType, body, fileName);
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

async function runCompress(payload: CompressPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const source = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
  const optimized = await PDFDocument.create();
  const pages = await optimized.copyPages(source, source.getPageIndices());
  pages.forEach((page) => optimized.addPage(page));

  const optimizedBytes = await optimized.save({
    useObjectStreams: true,
    addDefaultPage: false,
    objectsPerTick: 50
  });
  const optimizedBuffer = Buffer.from(optimizedBytes);
  const outputBuffer =
    optimizedBuffer.byteLength <= inputBuffer.byteLength ? optimizedBuffer : inputBuffer;

  const fileName = safePdfName(payload.outputName);
  const objectKey = `outputs/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

async function runProtect(payload: ProtectPayload): Promise<string> {
  const inputPath = resolveStoragePath(payload.fileKey);

  const outputBuffer = await withTempDir(async (dir) => {
    const outputPath = resolve(dir, `protected-${randomUUID()}.pdf`);
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
  return uploadObject(objectKey, "application/pdf", outputBuffer, fileName);
}

async function runUnlock(payload: UnlockPayload): Promise<string> {
  const inputPath = resolveStoragePath(payload.fileKey);

  const outputBuffer = await withTempDir(async (dir) => {
    const outputPath = resolve(dir, `unlocked-${randomUUID()}.pdf`);
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

async function runPdfToWord(payload: ConvertPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const docxBuffer = await createDocxBuffer(extractPdfTextLines(inputBuffer));
  const fileName = safeNameWithExtension(payload.outputName, ".docx");
  return saveOutputFile(
    fileName,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    docxBuffer
  );
}

async function runPdfToPowerpoint(payload: ConvertPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const pptxBuffer = await createPptxBuffer(extractPdfTextLines(inputBuffer));
  const fileName = safeNameWithExtension(payload.outputName, ".pptx");
  return saveOutputFile(
    fileName,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pptxBuffer
  );
}

async function runPdfToExcel(payload: ConvertPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const xlsxBuffer = await createXlsxBuffer(extractPdfTextLines(inputBuffer));
  const fileName = safeNameWithExtension(payload.outputName, ".xlsx");
  return saveOutputFile(
    fileName,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsxBuffer
  );
}

async function runEdit(payload: EditPayload): Promise<string> {
  const inputBuffer = await downloadObject(payload.fileKey);
  const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageAt = (pageNumber: number) => {
    if (pageNumber > pages.length) {
      throw new Error(`Invalid page number ${pageNumber}. PDF has ${pages.length} page(s).`);
    }
    return pages[pageNumber - 1];
  };

  for (const item of payload.textEdits) {
    const page = pageAt(item.page);
    const color = parseHexColor(item.color);
    page.drawText(item.text, {
      x: item.x,
      y: item.y,
      size: item.fontSize,
      font,
      color: rgb(color.red / 255, color.green / 255, color.blue / 255)
    });
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
  }

  const editedBuffer = Buffer.from(await pdfDoc.save());
  const fileName = safePdfName(payload.outputName);
  return saveOutputFile(fileName, "application/pdf", editedBuffer);
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

  if (name === "compress") {
    const payload = CompressPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runCompress(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "protect") {
    const payload = ProtectPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runProtect(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "unlock") {
    const payload = UnlockPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runUnlock(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "pdf-to-word") {
    const payload = ConvertPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runPdfToWord(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "pdf-to-powerpoint") {
    const payload = ConvertPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runPdfToPowerpoint(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "pdf-to-excel") {
    const payload = ConvertPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runPdfToExcel(payload);
    await markCompleted(payload.taskId, outputFileId);
    return;
  }

  if (name === "edit") {
    const payload = EditPayloadSchema.parse(data);
    await markProcessing(payload.taskId);
    const outputFileId = await runEdit(payload);
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
