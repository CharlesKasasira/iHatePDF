import { BadRequestException, Controller, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import { env } from "../config/env.js";
import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation"
]);

function fieldValue(field?: unknown): string | undefined {
  const entry = Array.isArray(field) ? field[0] : field;
  if (
    typeof entry === "object" &&
    entry !== null &&
    "type" in entry &&
    "value" in entry &&
    (entry as { type?: unknown }).type === "field"
  ) {
    return String((entry as { value: unknown }).value);
  }

  return undefined;
}

function parseRetentionHours(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 24 * 365) {
    throw new BadRequestException("Invalid retention period.");
  }

  return parsed;
}

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  @Post()
  async uploadFile(
    @Req() request: FastifyRequest
  ): Promise<{ fileId: string; objectKey: string; fileName: string }> {
    if (!request.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data request with a "file" field.');
    }

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    const RequestFileTooLargeError = request.server.multipartErrors.RequestFileTooLargeError;

    let part: Awaited<ReturnType<FastifyRequest["file"]>>;
    try {
      part = await request.file({
        limits: {
          files: 1,
          fileSize: maxBytes
        }
      });
    } catch (error) {
      if (error instanceof RequestFileTooLargeError) {
        throw new BadRequestException(`File too large. Max allowed is ${env.MAX_UPLOAD_MB}MB.`);
      }
      throw error;
    }

    if (!part) {
      throw new BadRequestException('No file was uploaded. Use the "file" field.');
    }

    if (!part.filename.trim()) {
      part.file.resume();
      throw new BadRequestException("Uploaded file name is empty.");
    }

    const retentionHours = parseRetentionHours(fieldValue(part.fields.retentionHours));

    if (!ALLOWED_UPLOAD_MIME_TYPES.has(part.mimetype)) {
      part.file.resume();
      throw new BadRequestException(
        "Unsupported file type. Upload PDF, JPG/JPEG, Word (.docx), Excel (.xlsx), or PowerPoint (.pptx)."
      );
    }

    let stored: Awaited<ReturnType<StorageService["saveFileStream"]>>;
    try {
      stored = await this.storageService.saveFileStream(
        part.filename,
        part.mimetype,
        part.file,
        "uploads"
      );
    } catch (error) {
      if (part.file.truncated || error instanceof RequestFileTooLargeError) {
        throw new BadRequestException(`File too large. Max allowed is ${env.MAX_UPLOAD_MB}MB.`);
      }
      throw error;
    }

    if (stored.sizeBytes <= 0) {
      throw new BadRequestException("Uploaded file content is empty.");
    }

    const currentUser = await this.authService.currentUser(request);
    const dbFile = await this.prisma.fileObject.create({
      data: {
        objectKey: stored.objectKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: BigInt(stored.sizeBytes),
        ownerId: currentUser?.id ?? null,
        expiresAt: retentionHours
          ? new Date(Date.now() + retentionHours * 60 * 60 * 1000)
          : null
      }
    });

    return {
      fileId: dbFile.id,
      objectKey: dbFile.objectKey,
      fileName: dbFile.fileName
    };
  }
}
