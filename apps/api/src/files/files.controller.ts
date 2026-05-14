import {
  BadRequestException,
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Res
} from "@nestjs/common";
import type { FastifyReply } from "fastify";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

type PdfPageMetadata = {
  pageNumber: number;
  width: number;
  height: number;
};

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });
  });
}

@Controller("files")
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  @Get(":id/metadata")
  async metadata(
    @Param("id") id: string
  ): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    pageCount: number;
    pages: PdfPageMetadata[];
  }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    if (file.expiresAt && file.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("File retention window has expired.");
    }

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Metadata inspection is only available for PDF files.");
    }

    try {
      const buffer = await this.storageService.readObjectBuffer(file.objectKey);
      const pdf = await PDFDocument.load(buffer);
      const pages = pdf.getPages().map((page, index) => {
        const { width, height } = page.getSize();
        return {
          pageNumber: index + 1,
          width,
          height
        };
      });

      return {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        pageCount: pdf.getPageCount(),
        pages
      };
    } catch {
      throw new BadRequestException("Unable to inspect PDF metadata.");
    }
  }

  @Get(":id/pages/:page/preview")
  async pagePreview(
    @Param("id") id: string,
    @Param("page") pageValue: string,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    if (file.expiresAt && file.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("File retention window has expired.");
    }

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Preview rendering is only available for PDF files.");
    }

    const pageNumber = Number(pageValue);
    if (!Number.isInteger(pageNumber) || pageNumber <= 0) {
      throw new BadRequestException("Invalid page number.");
    }

    let buffer: Buffer;
    let pageCount: number;

    try {
      buffer = await this.storageService.readObjectBuffer(file.objectKey);
      const pdf = await PDFDocument.load(buffer);
      pageCount = pdf.getPageCount();
    } catch {
      throw new BadRequestException("Unable to inspect PDF preview data.");
    }

    if (pageNumber > pageCount) {
      throw new BadRequestException(`Invalid page number ${pageNumber}. PDF has ${pageCount} page(s).`);
    }

    const dir = await mkdtemp(resolve(tmpdir(), "ihatepdf-preview-"));

    try {
      const inputPath = resolve(dir, "source.pdf");
      const outputPrefix = resolve(dir, "page");
      const outputPath = `${outputPrefix}.png`;

      await writeFile(inputPath, buffer);
      await runCommand(env.PDFTOPPM_BIN, [
        "-png",
        "-f",
        String(pageNumber),
        "-singlefile",
        "-r",
        String(env.PDF_RENDER_DPI),
        inputPath,
        outputPrefix
      ]);

      const availableFiles = await readdir(dir);
      if (!availableFiles.includes("page.png")) {
        throw new Error("Preview image was not generated.");
      }

      const png = await readFile(outputPath);
      reply.header("Content-Type", "image/png");
      reply.header("Cache-Control", "private, max-age=300");
      reply.send(png);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BadRequestException(`Unable to render PDF preview. ${message}`);
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  @Get(":id/download")
  async download(@Param("id") id: string, @Res() reply: FastifyReply): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    if (file.expiresAt && file.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("File retention window has expired.");
    }

    let object: Awaited<ReturnType<StorageService["openObjectReadStream"]>>;

    try {
      object = await this.storageService.openObjectReadStream(file.objectKey);
    } catch {
      throw new NotFoundException("File content not found.");
    }

    const normalizedFileName = safeFileName(file.fileName);

    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Disposition", `attachment; filename=\"${normalizedFileName}\"`);
    reply.header("Content-Length", String(object.sizeBytes));
    reply.send(object.stream);
  }
}
