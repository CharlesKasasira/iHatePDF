import {
  BadRequestException,
  Body,
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Post,
  Req,
  Res
} from "@nestjs/common";
import { IsEmail, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SignatureEnvelopeStatus, type FileObject } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
import { env } from "../config/env.js";
import { AuthService } from "../auth/auth.service.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RateLimit } from "../rate-limit/rate-limit.decorator.js";
import { StorageService } from "../storage/storage.service.js";

type PdfPageMetadata = {
  pageNumber: number;
  width: number;
  height: number;
};

class CreateFileShareDto {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 30)
  expiresInHours?: number;

  @IsOptional()
  @IsIn(["download", "editor"])
  mode?: "download" | "editor";
}

type FileShareResponse = {
  id: string;
  token: string;
  fileName: string;
  shareUrl: string;
  downloadUrl: string;
  expiresAt: string;
  emailSent: boolean;
};

type SharedFileMetadataResponse = {
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  expiresAt: string;
  downloadUrl: string;
};

function safeFileName(fileName: string): string {
  return fileName.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function isEnvelopeOpen(status: SignatureEnvelopeStatus): boolean {
  return status === SignatureEnvelopeStatus.sent || status === SignatureEnvelopeStatus.in_progress;
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
    private readonly storageService: StorageService,
    private readonly authService: AuthService,
    private readonly mailService: MailService
  ) {}

  private async assertCanAccessFile(file: FileObject, request: FastifyRequest): Promise<void> {
    if (!file.ownerId) {
      return;
    }

    const user = await this.authService.currentUser(request);
    if (user?.id !== file.ownerId) {
      throw new NotFoundException("File not found.");
    }
  }

  private assertFileAvailable(file: FileObject): void {
    if (file.expiresAt && file.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("File retention window has expired.");
    }
  }

  private async inspectPdfMetadata(file: FileObject): Promise<{
    id: string;
    fileName: string;
    mimeType: string;
    pageCount: number;
    pages: PdfPageMetadata[];
  }> {
    this.assertFileAvailable(file);

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

  private async renderPagePreview(
    file: FileObject,
    pageValue: string,
    reply: FastifyReply
  ): Promise<void> {
    this.assertFileAvailable(file);

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

  private async streamDownload(file: FileObject, reply: FastifyReply): Promise<void> {
    this.assertFileAvailable(file);

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

  private createShareToken(): string {
    return randomBytes(32).toString("base64url");
  }

  private createShareUrl(token: string, mode: "download" | "editor" = "download"): string {
    const encodedToken = encodeURIComponent(token);
    if (mode === "editor") {
      return `${env.APP_BASE_URL}/editor-studio?shared=${encodedToken}`;
    }

    return `${env.APP_BASE_URL}/shared/${encodedToken}`;
  }

  private createSharedDownloadUrl(token: string): string {
    return `${env.API_PUBLIC_URL}/api/files/shared/${encodeURIComponent(token)}/download`;
  }

  private resolveShareExpiry(file: FileObject, expiresInHours?: number): Date {
    const requestedExpiry = new Date(
      Date.now() + (expiresInHours ?? env.FILE_SHARE_TTL_HOURS) * 60 * 60 * 1000
    );

    if (!file.expiresAt || file.expiresAt.getTime() > requestedExpiry.getTime()) {
      return requestedExpiry;
    }

    return file.expiresAt;
  }

  private async loadActiveShare(token: string): Promise<{
    token: string;
    expiresAt: Date;
    file: FileObject;
  }> {
    const share = await this.prisma.fileShare.findUnique({
      where: { token },
      include: { file: true }
    });

    if (!share) {
      throw new NotFoundException("Shared file not found.");
    }

    if (share.expiresAt.getTime() <= Date.now()) {
      throw new GoneException("This shared link has expired.");
    }

    this.assertFileAvailable(share.file);

    return share;
  }

  @Post(":id/share")
  @RateLimit("share")
  async createShare(
    @Param("id") id: string,
    @Body() dto: CreateFileShareDto,
    @Req() request: FastifyRequest
  ): Promise<FileShareResponse> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    await this.assertCanAccessFile(file, request);
    this.assertFileAvailable(file);

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Only PDF files can be shared with this tool.");
    }

    const currentUser = await this.authService.currentUser(request);
    const expiresAt = this.resolveShareExpiry(file, dto.expiresInHours);
    if (expiresAt.getTime() <= Date.now()) {
      throw new GoneException("File retention window has expired.");
    }

    const share = await this.prisma.fileShare.create({
      data: {
        token: this.createShareToken(),
        fileId: file.id,
        createdById: currentUser?.id ?? null,
        recipientEmail: dto.email?.trim().toLowerCase() || null,
        message: dto.message?.trim() || null,
        expiresAt
      }
    });

    const shareMode = dto.mode ?? "download";
    const shareUrl = this.createShareUrl(share.token, shareMode);
    if (share.recipientEmail) {
      await this.mailService.sendPdfShareMail({
        to: share.recipientEmail,
        fileName: file.fileName,
        shareLink: shareUrl,
        message: share.message ?? undefined,
        expiresAt: share.expiresAt,
        mode: shareMode
      });
    }

    return {
      id: share.id,
      token: share.token,
      fileName: file.fileName,
      shareUrl,
      downloadUrl: this.createSharedDownloadUrl(share.token),
      expiresAt: share.expiresAt.toISOString(),
      emailSent: Boolean(share.recipientEmail)
    };
  }

  @Get("shared/:token")
  async sharedMetadata(@Param("token") token: string): Promise<SharedFileMetadataResponse> {
    const share = await this.loadActiveShare(token);

    return {
      fileName: share.file.fileName,
      mimeType: share.file.mimeType,
      sizeBytes: share.file.sizeBytes.toString(),
      expiresAt: share.expiresAt.toISOString(),
      downloadUrl: this.createSharedDownloadUrl(share.token)
    };
  }

  @Get("shared/:token/download")
  async sharedDownload(
    @Param("token") token: string,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const share = await this.loadActiveShare(token);

    await this.prisma.fileShare.update({
      where: { token },
      data: {
        lastAccessedAt: new Date(),
        downloadCount: { increment: 1 }
      }
    });

    await this.streamDownload(share.file, reply);
  }

  @Get(":id/metadata")
  async metadata(
    @Param("id") id: string,
    @Req() request: FastifyRequest
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

    await this.assertCanAccessFile(file, request);
    return this.inspectPdfMetadata(file);
  }

  @Get(":id/pages/:page/preview")
  async pagePreview(
    @Param("id") id: string,
    @Param("page") pageValue: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    await this.assertCanAccessFile(file, request);
    await this.renderPagePreview(file, pageValue, reply);
  }

  @Get(":id/download")
  async download(
    @Param("id") id: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!file) {
      throw new NotFoundException("File not found.");
    }

    await this.assertCanAccessFile(file, request);
    await this.streamDownload(file, reply);
  }

  @Get("signature-requests/:token/metadata")
  async signatureRequestMetadata(@Param("token") token: string) {
    const file = await this.loadSignatureSourceFile(token);
    return this.inspectPdfMetadata(file);
  }

  @Get("signature-requests/:token/pages/:page/preview")
  async signatureRequestPagePreview(
    @Param("token") token: string,
    @Param("page") pageValue: string,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const file = await this.loadSignatureSourceFile(token);
    await this.renderPagePreview(file, pageValue, reply);
  }

  @Get("signature-requests/:token/final-download")
  async signatureRequestFinalDownload(
    @Param("token") token: string,
    @Res() reply: FastifyReply
  ): Promise<void> {
    const recipient = await this.prisma.signatureEnvelopeRecipient.findUnique({
      where: { token },
      include: {
        envelope: {
          include: {
            finalFile: true
          }
        }
      }
    });

    if (!recipient || !recipient.envelope.finalFile) {
      throw new NotFoundException("Final signed PDF not found.");
    }

    if (recipient.envelope.status === SignatureEnvelopeStatus.revoked) {
      throw new GoneException("This signing workflow has been revoked.");
    }

    if (!recipient.otpVerifiedAt || (recipient.passcodeHash && !recipient.passcodeVerifiedAt)) {
      throw new GoneException("Verify your identity before downloading the final signed PDF.");
    }

    await this.streamDownload(recipient.envelope.finalFile, reply);
  }

  private async loadSignatureSourceFile(token: string): Promise<FileObject> {
    const recipient = await this.prisma.signatureEnvelopeRecipient.findUnique({
      where: { token },
      include: {
        envelope: {
          include: {
            sourceFile: true
          }
        }
      }
    });

    if (!recipient) {
      throw new NotFoundException("Signing request not found.");
    }

    const envelope = await this.expireSignatureEnvelopeIfNeeded(recipient.envelope);
    if (envelope.status === SignatureEnvelopeStatus.expired) {
      throw new GoneException("This signing workflow has expired.");
    }

    if (envelope.status === SignatureEnvelopeStatus.revoked) {
      throw new GoneException("This signing workflow has been revoked.");
    }

    if (!recipient.otpVerifiedAt || (recipient.passcodeHash && !recipient.passcodeVerifiedAt)) {
      throw new GoneException("Verify your identity before viewing this signing document.");
    }

    return recipient.envelope.sourceFile;
  }

  private async expireSignatureEnvelopeIfNeeded<TEnvelope extends {
    id: string;
    status: SignatureEnvelopeStatus;
    expiresAt: Date;
  }>(envelope: TEnvelope): Promise<TEnvelope> {
    if (!isEnvelopeOpen(envelope.status) || envelope.expiresAt.getTime() >= Date.now()) {
      return envelope;
    }

    await this.prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data: { status: SignatureEnvelopeStatus.expired }
    });

    return {
      ...envelope,
      status: SignatureEnvelopeStatus.expired
    };
  }
}
