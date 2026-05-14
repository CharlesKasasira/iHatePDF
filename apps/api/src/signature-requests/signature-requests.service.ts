import { BadRequestException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Prisma, SignatureRequestStatus, TaskType } from "@prisma/client";
import { PDFDocument } from "pdf-lib";
import { env } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { StorageService } from "../storage/storage.service.js";

interface CreateSignatureRequestInput {
  fileId: string;
  requesterEmail: string;
  signerName?: string;
  signerEmail: string;
  signerRole?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
  message?: string;
}

interface StoredSignatureRequestPayload {
  signerName?: string;
  signerRole?: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
  pageWidth: number;
  pageHeight: number;
}

interface CompleteSignatureRequestInput {
  signatureDataUrl: string;
}

@Injectable()
export class SignatureRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService
  ) {}

  async createRequest(input: CreateSignatureRequestInput): Promise<{ id: string; token: string; signingUrl: string }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: input.fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Signature requests require a PDF input file.");
    }

    const fileBuffer = await this.storageService.readObjectBuffer(file.objectKey);
    const pdf = await PDFDocument.load(fileBuffer);
    const pageIndex = input.page - 1;
    if (pageIndex < 0 || pageIndex >= pdf.getPageCount()) {
      throw new BadRequestException(`Invalid page number ${input.page}. PDF has ${pdf.getPageCount()} page(s).`);
    }

    const page = pdf.getPage(pageIndex);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    if (input.x + input.width > pageWidth || input.y + input.height > pageHeight) {
      throw new BadRequestException("Signature box exceeds the selected PDF page bounds.");
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + env.SIGN_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    const payload: StoredSignatureRequestPayload = {
      signerName: input.signerName?.trim() || undefined,
      signerRole: input.signerRole?.trim() || undefined,
      page: input.page,
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      outputName: input.outputName,
      pageWidth,
      pageHeight
    };

    const request = await this.prisma.signatureRequest.create({
      data: {
        token,
        fileId: file.id,
        requesterEmail: input.requesterEmail,
        signerEmail: input.signerEmail,
        message: input.message,
        payload: payload as unknown as Prisma.InputJsonValue,
        expiresAt
      }
    });

    const signingLink = `${env.APP_BASE_URL}/sign-request/${token}`;
    await this.mailService.sendSignatureRequestMail(input.signerEmail, signingLink, input.message);

    return { id: request.id, token: request.token, signingUrl: signingLink };
  }

  async getByToken(token: string): Promise<{
    id: string;
    token: string;
    status: SignatureRequestStatus;
    fileId: string;
    fileName: string;
    expiresAt: Date;
    message: string | null;
    signerName?: string;
    signerRole?: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    outputName: string;
    pageWidth: number;
    pageHeight: number;
  }> {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { token },
      include: { file: true }
    });

    if (!request) {
      throw new NotFoundException("Signature request not found.");
    }

    const payload = request.payload as StoredSignatureRequestPayload | null;
    if (!payload) {
      throw new BadRequestException("Signature request placement data is missing.");
    }

    return {
      id: request.id,
      token: request.token,
      status: request.status,
      fileId: request.fileId,
      fileName: request.file.fileName,
      expiresAt: request.expiresAt,
      message: request.message,
      signerName: payload.signerName,
      signerRole: payload.signerRole,
      page: payload.page,
      x: payload.x,
      y: payload.y,
      width: payload.width,
      height: payload.height,
      outputName: payload.outputName,
      pageWidth: payload.pageWidth,
      pageHeight: payload.pageHeight
    };
  }

  async completeByToken(
    token: string,
    payload: CompleteSignatureRequestInput
  ): Promise<{ taskId: string }> {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { token },
      include: { file: true }
    });

    if (!request) {
      throw new NotFoundException("Signature request not found.");
    }

    if (request.status !== SignatureRequestStatus.pending) {
      throw new BadRequestException("Signature request is not pending.");
    }

    if (request.expiresAt.getTime() < Date.now()) {
      await this.prisma.signatureRequest.update({
        where: { id: request.id },
        data: { status: SignatureRequestStatus.expired }
      });
      throw new GoneException("Signature request is expired.");
    }

    const storedPayload = request.payload as StoredSignatureRequestPayload | null;
    if (!storedPayload) {
      throw new BadRequestException("Signature request placement data is missing.");
    }

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.sign,
        status: "queued",
        inputFileId: request.fileId,
        payload: {
          fileKey: request.file.objectKey,
          ...storedPayload,
          ...payload
        }
      }
    });

    await this.queueService.enqueue("sign", {
      taskId: task.id,
      fileKey: request.file.objectKey,
      ...storedPayload,
      ...payload
    });

    await this.prisma.signatureRequest.update({
      where: { id: request.id },
      data: {
        signedTaskId: task.id
      }
    });

    return { taskId: task.id };
  }
}
