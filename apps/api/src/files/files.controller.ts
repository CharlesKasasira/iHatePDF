import { Controller, Get, NotFoundException, Param, Res } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

@Controller("files")
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  @Get(":id/download")
  async download(@Param("id") id: string, @Res() reply: any): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    let data: Buffer;

    try {
      data = await this.storageService.readObjectBuffer(file.objectKey);
    } catch {
      throw new NotFoundException("File content not found.");
    }

    const safeFileName = file.fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");

    reply.header("Content-Type", file.mimeType);
    reply.header("Content-Disposition", `attachment; filename=\"${safeFileName}\"`);
    reply.send(data);
  }
}
