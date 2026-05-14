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
import { PDFDocument } from "pdf-lib";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Controller("files")
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  @Get(":id/metadata")
  async metadata(
    @Param("id") id: string
  ): Promise<{ id: string; fileName: string; mimeType: string; pageCount: number }> {
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
      return {
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        pageCount: pdf.getPageCount()
      };
    } catch {
      throw new BadRequestException("Unable to inspect PDF metadata.");
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

    const safeFileName = file.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");

    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    reply.header("Content-Length", String(object.sizeBytes));
    reply.send(object.stream);
  }
}
