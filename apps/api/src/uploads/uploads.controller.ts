import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { IsNotEmpty, IsString } from "class-validator";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

class UploadPdfDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsString()
  @IsNotEmpty()
  dataBase64!: string;
}

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService
  ) {}

  @Post()
  async uploadPdf(@Body() dto: UploadPdfDto): Promise<{ fileId: string; objectKey: string; fileName: string }> {
    if (dto.mimeType !== "application/pdf") {
      throw new BadRequestException("Only PDF files are supported.");
    }

    let data: Buffer;
    try {
      data = Buffer.from(dto.dataBase64, "base64");
    } catch {
      throw new BadRequestException("Invalid base64 payload.");
    }

    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (data.byteLength <= 0) {
      throw new BadRequestException("Uploaded file content is empty.");
    }

    if (data.byteLength > maxBytes) {
      throw new BadRequestException(`File too large. Max allowed is ${env.MAX_UPLOAD_MB}MB.`);
    }

    const stored = await this.storageService.saveFile(dto.fileName, dto.mimeType, data, "uploads");

    const dbFile = await this.prisma.fileObject.create({
      data: {
        objectKey: stored.objectKey,
        fileName: stored.fileName,
        mimeType: stored.mimeType,
        sizeBytes: BigInt(stored.sizeBytes)
      }
    });

    return {
      fileId: dbFile.id,
      objectKey: dbFile.objectKey,
      fileName: dbFile.fileName
    };
  }
}
