import { BadRequestException, GoneException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { SignatureRequestStatus, TaskType } from "@prisma/client";
import { env } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";

interface CreateSignatureRequestInput {
  fileId: string;
  requesterEmail: string;
  signerEmail: string;
  message?: string;
}

interface CompleteSignatureRequestInput {
  signatureDataUrl: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  outputName: string;
}

@Injectable()
export class SignatureRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly mailService: MailService
  ) {}

  async createRequest(input: CreateSignatureRequestInput): Promise<{ id: string; token: string }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: input.fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

    const token = randomBytes(24).toString("hex");
    const expiresAt = new Date(Date.now() + env.SIGN_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const request = await this.prisma.signatureRequest.create({
      data: {
        token,
        fileId: file.id,
        requesterEmail: input.requesterEmail,
        signerEmail: input.signerEmail,
        message: input.message,
        expiresAt
      }
    });

    const signingLink = `${env.APP_BASE_URL}/sign-request/${token}`;
    await this.mailService.sendSignatureRequestMail(input.signerEmail, signingLink, input.message);

    return { id: request.id, token: request.token };
  }

  async getByToken(token: string): Promise<{
    id: string;
    token: string;
    status: SignatureRequestStatus;
    fileName: string;
    expiresAt: Date;
    message: string | null;
  }> {
    const request = await this.prisma.signatureRequest.findUnique({
      where: { token },
      include: { file: true }
    });

    if (!request) {
      throw new NotFoundException("Signature request not found.");
    }

    return {
      id: request.id,
      token: request.token,
      status: request.status,
      fileName: request.file.fileName,
      expiresAt: request.expiresAt,
      message: request.message
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

    const task = await this.prisma.task.create({
      data: {
        type: TaskType.sign,
        status: "queued",
        inputFileId: request.fileId,
        payload: {
          fileKey: request.file.objectKey,
          ...payload
        }
      }
    });

    await this.queueService.enqueue("sign", {
      taskId: task.id,
      fileKey: request.file.objectKey,
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
