import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import {
  SignatureEnvelopeStatus,
  SignatureEnvelopeEventType,
  SignatureRequestStatus
} from "@prisma/client";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { StorageService } from "../storage/storage.service.js";

type CleanupStats = {
  expiredSessions: number;
  expiredResetTokens: number;
  expiredSignatureRequests: number;
  expiredEnvelopes: number;
  deletedSignatureRequests: number;
  deletedEnvelopes: number;
  deletedFiles: number;
};

const CLEANUP_LOCK_KEY = 51842001;

@Injectable()
export class CleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CleanupService.name);
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService
  ) {}

  onModuleInit(): void {
    if (!env.CLEANUP_ENABLED) {
      this.logger.log("Automated cleanup is disabled.");
      return;
    }

    void this.runCleanup("startup");
    this.intervalHandle = setInterval(
      () => void this.runCleanup("interval"),
      env.CLEANUP_INTERVAL_MINUTES * 60 * 1000
    );
    this.intervalHandle.unref();
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async runCleanup(trigger: "startup" | "interval"): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    const acquiredLock = await this.acquireCleanupLock();
    if (!acquiredLock) {
      this.running = false;
      return;
    }

    try {
      const now = new Date();
      const workflowCutoff = new Date(
        now.getTime() - env.CLEANUP_WORKFLOW_RETENTION_DAYS * 24 * 60 * 60 * 1000
      );

      const stats: CleanupStats = {
        expiredSessions: await this.cleanupSessions(now),
        expiredResetTokens: await this.cleanupPasswordResetTokens(now),
        expiredSignatureRequests: await this.expireSignatureRequests(now),
        expiredEnvelopes: await this.expireSignatureEnvelopes(now),
        deletedSignatureRequests: await this.deleteStaleSignatureRequests(workflowCutoff),
        deletedEnvelopes: await this.deleteStaleSignatureEnvelopes(workflowCutoff),
        deletedFiles: await this.deleteExpiredFiles(now)
      };

      const workDone = Object.values(stats).some((value) => value > 0);
      if (workDone) {
        this.logger.log(
          `Cleanup (${trigger}) removed sessions=${stats.expiredSessions}, resetTokens=${stats.expiredResetTokens}, expiredSignatureRequests=${stats.expiredSignatureRequests}, expiredEnvelopes=${stats.expiredEnvelopes}, deletedSignatureRequests=${stats.deletedSignatureRequests}, deletedEnvelopes=${stats.deletedEnvelopes}, deletedFiles=${stats.deletedFiles}.`
        );
      }
    } catch (error) {
      this.logger.error(
        `Cleanup run failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      await this.releaseCleanupLock();
      this.running = false;
    }
  }

  private async acquireCleanupLock(): Promise<boolean> {
    try {
      const rows = await this.prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(${CLEANUP_LOCK_KEY}) AS locked
      `;
      return rows[0]?.locked ?? false;
    } catch (error) {
      this.logger.warn(
        `Unable to acquire cleanup advisory lock: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  private async releaseCleanupLock(): Promise<void> {
    try {
      await this.prisma.$queryRaw`
        SELECT pg_advisory_unlock(${CLEANUP_LOCK_KEY})
      `;
    } catch (error) {
      this.logger.warn(
        `Unable to release cleanup advisory lock: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private cleanupSessions(now: Date): Promise<number> {
    return this.prisma.userSession
      .deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }]
        }
      })
      .then((result) => result.count);
  }

  private cleanupPasswordResetTokens(now: Date): Promise<number> {
    return this.prisma.passwordResetToken
      .deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { usedAt: { not: null } }]
        }
      })
      .then((result) => result.count);
  }

  private expireSignatureRequests(now: Date): Promise<number> {
    return this.prisma.signatureRequest
      .updateMany({
        where: {
          status: SignatureRequestStatus.pending,
          expiresAt: { lt: now }
        },
        data: {
          status: SignatureRequestStatus.expired
        }
      })
      .then((result) => result.count);
  }

  private async expireSignatureEnvelopes(now: Date): Promise<number> {
    const expired = await this.prisma.signatureEnvelope.findMany({
      where: {
        status: {
          in: [SignatureEnvelopeStatus.sent, SignatureEnvelopeStatus.in_progress]
        },
        expiresAt: { lt: now }
      },
      select: {
        id: true,
        requesterEmail: true
      },
      take: env.CLEANUP_BATCH_SIZE,
      orderBy: { expiresAt: "asc" }
    });

    if (expired.length === 0) {
      return 0;
    }

    const expiredIds = expired.map((envelope) => envelope.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelope.updateMany({
        where: {
          id: { in: expiredIds },
          status: {
            in: [SignatureEnvelopeStatus.sent, SignatureEnvelopeStatus.in_progress]
          }
        },
        data: {
          status: SignatureEnvelopeStatus.expired
        }
      });

      await tx.signatureEnvelopeEvent.createMany({
        data: expired.map((envelope) => ({
          envelopeId: envelope.id,
          type: SignatureEnvelopeEventType.expired,
          actorEmail: envelope.requesterEmail,
          description: "Signing workflow expired before all recipients completed."
        }))
      });
    });

    return expired.length;
  }

  private deleteStaleSignatureRequests(cutoff: Date): Promise<number> {
    return this.prisma.signatureRequest
      .deleteMany({
        where: {
          status: {
            in: [
              SignatureRequestStatus.completed,
              SignatureRequestStatus.expired,
              SignatureRequestStatus.cancelled
            ]
          },
          expiresAt: { lt: cutoff }
        }
      })
      .then((result) => result.count);
  }

  private deleteStaleSignatureEnvelopes(cutoff: Date): Promise<number> {
    return this.prisma.signatureEnvelope
      .deleteMany({
        where: {
          status: {
            in: [
              SignatureEnvelopeStatus.completed,
              SignatureEnvelopeStatus.expired,
              SignatureEnvelopeStatus.revoked,
              SignatureEnvelopeStatus.finalization_failed
            ]
          },
          expiresAt: { lt: cutoff }
        }
      })
      .then((result) => result.count);
  }

  private async deleteExpiredFiles(now: Date): Promise<number> {
    const files = await this.prisma.fileObject.findMany({
      where: {
        expiresAt: { lt: now }
      },
      select: {
        id: true,
        objectKey: true,
        fileName: true,
        mimeType: true,
        sizeBytes: true,
        ownerId: true,
        createdAt: true,
        expiresAt: true,
        owner: {
          select: { email: true }
        }
      },
      take: env.CLEANUP_BATCH_SIZE,
      orderBy: { expiresAt: "asc" }
    });

    let deletedCount = 0;

    for (const file of files) {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await tx.task.updateMany({
          where: { inputFileId: file.id },
          data: { inputFileId: null }
        });

        await tx.task.updateMany({
          where: { outputFileId: file.id },
          data: { outputFileId: null }
        });

        await tx.signatureEnvelope.updateMany({
          where: { finalFileId: file.id },
          data: { finalFileId: null }
        });

        const references = await tx.fileObject.findUnique({
          where: { id: file.id },
          select: {
            _count: {
              select: {
                tasksAsInput: true,
                tasksAsOutput: true,
                signatureRequests: true,
                signatureEnvelopesAsSource: true,
                signatureEnvelopesAsFinal: true
              }
            }
          }
        });

        if (!references) {
          return false;
        }

        if (
          references._count.tasksAsInput > 0 ||
          references._count.tasksAsOutput > 0 ||
          references._count.signatureRequests > 0 ||
          references._count.signatureEnvelopesAsSource > 0 ||
          references._count.signatureEnvelopesAsFinal > 0
        ) {
          return false;
        }

        await tx.fileObject.delete({
          where: { id: file.id }
        });

        return true;
      });

      if (!deleted) {
        continue;
      }

      deletedCount += 1;
      let storageDeleted = true;
      let storageError: string | null = null;
      await this.storageService.deleteObject(file.objectKey).catch((error) => {
        storageDeleted = false;
        storageError = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Deleted file record ${file.id} but failed to remove stored object ${file.objectKey}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
      await this.prisma.fileDeletionReceipt.create({
        data: {
          fileId: file.id,
          objectKey: file.objectKey,
          fileName: file.fileName,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          ownerId: file.ownerId,
          ownerEmail: file.owner?.email ?? null,
          reason: "retention_expired",
          storageDeleted,
          storageError,
          fileCreatedAt: file.createdAt,
          expiresAt: file.expiresAt
        }
      });
    }

    return deletedCount;
  }
}
