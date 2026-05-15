import { Injectable } from "@nestjs/common";
import type { TaskStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

type AccountActivity = {
  files: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: string;
    createdAt: Date;
    expiresAt: Date | null;
    downloadUrl: string | null;
  }>;
  tasks: Array<{
    id: string;
    type: string;
    status: TaskStatus;
    progressPercent: number;
    errorMessage: string | null;
    createdAt: Date;
    updatedAt: Date;
    outputFileName: string | null;
    outputDownloadUrl: string | null;
  }>;
  signatureEnvelopes: Array<{
    id: string;
    title: string | null;
    requesterEmail: string;
    status: string;
    routing: string;
    outputName: string;
    fileName: string;
    createdAt: Date;
    expiresAt: Date;
    completedAt: Date | null;
    manageUrl: string;
    finalDownloadUrl: string | null;
    auditCertificateUrl: string | null;
  }>;
};

function isDownloadAvailable(file: { expiresAt: Date | null }): boolean {
  return !file.expiresAt || file.expiresAt.getTime() > Date.now();
}

@Injectable()
export class AccountService {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  async activity(request: FastifyRequest): Promise<AccountActivity> {
    const user = await this.authService.requireUser(request);

    const [files, tasks, signatureEnvelopes] = await Promise.all([
      this.prisma.fileObject.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.task.findMany({
        where: { ownerId: user.id },
        include: { outputFile: true },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.signatureEnvelope.findMany({
        where: { ownerId: user.id },
        include: {
          sourceFile: true,
          finalFile: true
        },
        orderBy: { createdAt: "desc" },
        take: 25
      })
    ]);

    return {
      files: files.map((file) => ({
        id: file.id,
        fileName: file.fileName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes.toString(),
        createdAt: file.createdAt,
        expiresAt: file.expiresAt,
        downloadUrl: isDownloadAvailable(file)
          ? this.storageService.createDownloadUrl(file.id)
          : null
      })),
      tasks: tasks.map((task) => ({
        id: task.id,
        type: task.type,
        status: task.status,
        progressPercent: task.progressPercent,
        errorMessage: task.errorMessage,
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
        outputFileName: task.outputFile?.fileName ?? null,
        outputDownloadUrl:
          task.outputFile && isDownloadAvailable(task.outputFile)
            ? this.storageService.createDownloadUrl(task.outputFile.id)
            : null
      })),
      signatureEnvelopes: signatureEnvelopes.map((envelope) => ({
        id: envelope.id,
        title: envelope.title,
        requesterEmail: envelope.requesterEmail,
        status: envelope.status,
        routing: envelope.routing,
        outputName: envelope.outputName,
        fileName: envelope.sourceFile.fileName,
        createdAt: envelope.createdAt,
        expiresAt: envelope.expiresAt,
        completedAt: envelope.completedAt,
        manageUrl: `${env.APP_BASE_URL}/sign-pdf?envelope=${encodeURIComponent(envelope.id)}`,
        finalDownloadUrl:
          envelope.finalFile && isDownloadAvailable(envelope.finalFile)
            ? this.storageService.createDownloadUrl(envelope.finalFile.id)
            : null,
        auditCertificateUrl:
          envelope.finalFile && isDownloadAvailable(envelope.finalFile)
            ? `${env.API_PUBLIC_URL}/api/signature-requests/envelopes/${encodeURIComponent(envelope.id)}/audit-certificate`
            : null
      }))
    };
  }
}
