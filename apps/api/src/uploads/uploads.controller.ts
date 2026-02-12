import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { IsInt, IsNotEmpty, IsString, Max, Min } from "class-validator";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

class PresignUploadDto {
  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

class CompleteUploadDto {
  @IsString()
  @IsNotEmpty()
  objectKey!: string;

  @IsString()
  @IsNotEmpty()
  fileName!: string;

  @IsString()
  @IsNotEmpty()
  mimeType!: string;

  @IsInt()
  @Min(1)
  sizeBytes!: number;
}

@Controller("uploads")
export class UploadsController {
  constructor(
    private readonly storageService: StorageService,
    private readonly prisma: PrismaService
  ) {}

  @Post("presign")
  async presignUpload(
    @Body() dto: PresignUploadDto
  ): Promise<{ objectKey: string; uploadUrl: string }> {
    const maxBytes = env.MAX_UPLOAD_MB * 1024 * 1024;
    if (dto.mimeType !== "application/pdf") {
      throw new BadRequestException("Only PDF files are supported for this endpoint.");
    }

    if (dto.sizeBytes > maxBytes) {
      throw new BadRequestException(`File too large. Max allowed is ${env.MAX_UPLOAD_MB}MB.`);
    }

    return this.storageService.createPresignedUpload(dto.fileName, dto.mimeType);
  }

  @Post("complete")
  async completeUpload(
    @Body() dto: CompleteUploadDto
  ): Promise<{ fileId: string; objectKey: string }> {
    const file = await this.prisma.fileObject.create({
      data: {
        objectKey: dto.objectKey,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        sizeBytes: BigInt(dto.sizeBytes)
      }
    });

    return {
      fileId: file.id,
      objectKey: file.objectKey
    };
  }
}
