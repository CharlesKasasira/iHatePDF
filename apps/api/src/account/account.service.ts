import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { UserSecurityEventType, type TaskStatus, type TaskType } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { AuthService } from "../auth/auth.service.js";
import { env } from "../config/env.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { StorageService } from "../storage/storage.service.js";

type AccountFileHistoryItem = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  createdAt: Date;
  expiresAt: Date | null;
  downloadUrl: string | null;
};

type AccountTaskItem = {
  id: string;
  type: string;
  status: TaskStatus;
  progressPercent: number;
  progressMessage: string | null;
  errorMessage: string | null;
  retryCount: number;
  lastRetriedAt: Date | null;
  canRetry: boolean;
  retryHint: string;
  createdAt: Date;
  updatedAt: Date;
  outputFileName: string | null;
  outputDownloadUrl: string | null;
};

type WebhookDeliveryItem = {
  id: string;
  endpointId: string;
  endpointUrl: string;
  endpointActive: boolean;
  eventType: string;
  status: string;
  responseStatus: number | null;
  errorMessage: string | null;
  attemptCount: number;
  deliveredAt: Date | null;
  createdAt: Date;
};

type AccountActivity = {
  files: AccountFileHistoryItem[];
  tasks: AccountTaskItem[];
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
  storageUsage: {
    totalBytes: string;
    fileCount: number;
    expiringSoonCount: number;
    largestFiles: AccountFileHistoryItem[];
  };
  apiUsage: {
    apiKeyCount: number;
    activeApiKeyCount: number;
    totalEvents: number;
    eventsLast30Days: number;
    keys: Array<{
      id: string;
      name: string;
      keyPrefix: string;
      lastUsedAt: Date | null;
      expiresAt: Date | null;
      revokedAt: Date | null;
      createdAt: Date;
      usageCount: number;
    }>;
    recentEvents: Array<{
      id: string;
      method: string;
      route: string;
      statusCode: number | null;
      taskId: string | null;
      fileId: string | null;
      apiKeyName: string | null;
      apiKeyPrefix: string | null;
      createdAt: Date;
    }>;
  };
  webhooks: {
    endpointCount: number;
    activeEndpointCount: number;
    deliveries: WebhookDeliveryItem[];
  };
  retryVisibility: {
    failedTaskCount: number;
    retriedTaskCount: number;
    tasks: AccountTaskItem[];
  };
};

type AdminDashboard = {
  generatedAt: Date;
  counts: {
    users: number;
    files: number;
    tasks: number;
    apiKeys: number;
    webhookEndpoints: number;
    webhookDeliveries: number;
  };
  storageUsage: {
    totalBytes: string;
    topOwners: Array<{
      ownerId: string | null;
      ownerEmail: string | null;
      fileCount: number;
      totalBytes: string;
    }>;
  };
  apiUsage: {
    totalEvents: number;
    eventsLast30Days: number;
    recentEvents: Array<{
      id: string;
      ownerEmail: string;
      apiKeyName: string | null;
      method: string;
      route: string;
      statusCode: number | null;
      taskId: string | null;
      fileId: string | null;
      createdAt: Date;
    }>;
  };
  webhookDeliveries: WebhookDeliveryItem[];
  taskRetryVisibility: {
    byStatus: Array<{ status: string; count: number }>;
    queue: Awaited<ReturnType<QueueService["getStatus"]>> | null;
    failedTasks: Array<AccountTaskItem & { ownerEmail: string | null }>;
  };
  retention: {
    expiring24hCount: number;
    expiring7dCount: number;
    expiredPendingDeletionCount: number;
    filesWithoutExpiryCount: number;
    oldestExpiryAt: Date | null;
    cleanupEnabled: boolean;
    cleanupIntervalMinutes: number;
  };
  antivirus: {
    enabled: boolean;
    engine: string;
    lastScanPolicy: string;
  };
  storageQuotas: Array<{
    ownerId: string | null;
    ownerEmail: string | null;
    usedBytes: string;
    quotaBytes: string;
    percentUsed: number;
    fileCount: number;
  }>;
  auditLog: Array<{
    id: string;
    type: string;
    email: string | null;
    actorEmail: string | null;
    ipAddress: string | null;
    description: string;
    createdAt: Date;
  }>;
  deletionReceipts: Array<{
    id: string;
    fileId: string | null;
    fileName: string;
    ownerEmail: string | null;
    sizeBytes: string;
    reason: string;
    storageDeleted: boolean;
    storageError: string | null;
    expiresAt: Date | null;
    deletedAt: Date;
  }>;
  jobHistory: Array<AccountTaskItem & { ownerEmail: string | null }>;
  fileHistory: Array<AccountFileHistoryItem & { ownerEmail: string | null }>;
};

type AdminUserManagementItem = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  suspendedAt: Date | null;
  lockedAt: Date | null;
  lockReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  counts: {
    files: number;
    tasks: number;
    apiKeys: number;
    sessions: number;
  };
  recentSecurityEvents: Array<{
    id: string;
    type: string;
    description: string;
    ipAddress: string | null;
    userAgent: string | null;
    actorEmail: string | null;
    createdAt: Date;
  }>;
};

type AdminApiKeyOversightItem = {
  id: string;
  name: string;
  keyPrefix: string;
  ownerId: string;
  ownerEmail: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  rateLimitedAt: Date | null;
  rateLimitReason: string | null;
  createdAt: Date;
  usage: {
    total: number;
    last30Days: number;
    byRoute: Array<{
      route: string;
      method: string;
      count: number;
      lastUsedAt: Date;
    }>;
  };
};

function isDownloadAvailable(file: { expiresAt: Date | null }): boolean {
  return !file.expiresAt || file.expiresAt.getTime() > Date.now();
}

function taskRetryHint(task: { type: TaskType; status: TaskStatus }): string {
  if (task.status !== "failed") {
    return "Only failed tasks can be retried.";
  }

  if (task.type === "signature_request") {
    return "Retry from the signature workflow finalization panel.";
  }

  return "Retry will requeue the same saved task payload.";
}

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function requestIp(request: FastifyRequest): string {
  const forwardedFor = firstHeaderValue(request.headers["x-forwarded-for"]);
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(",");
    if (firstIp?.trim()) {
      return firstIp.trim();
    }
  }

  return (
    firstHeaderValue(request.headers["cf-connecting-ip"]) ??
    firstHeaderValue(request.headers["x-real-ip"]) ??
    request.ip ??
    "unknown"
  );
}

function requestUserAgent(request: FastifyRequest): string | null {
  return firstHeaderValue(request.headers["user-agent"]);
}

@Injectable()
export class AccountService {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly storageService: StorageService,
    private readonly queueService: QueueService
  ) {}

  private fileDownloadUrl(file: { id: string; expiresAt: Date | null }): string | null {
    return isDownloadAvailable(file) ? this.storageService.createDownloadUrl(file.id) : null;
  }

  private mapFile(file: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: bigint;
    createdAt: Date;
    expiresAt: Date | null;
  }): AccountFileHistoryItem {
    return {
      id: file.id,
      fileName: file.fileName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes.toString(),
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      downloadUrl: this.fileDownloadUrl(file)
    };
  }

  private mapTask(task: {
    id: string;
    type: TaskType;
    status: TaskStatus;
    progressPercent: number;
    progressMessage: string | null;
    errorMessage: string | null;
    retryCount: number;
    lastRetriedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    outputFile: {
      id: string;
      fileName: string;
      expiresAt: Date | null;
    } | null;
  }): AccountTaskItem {
    return {
      id: task.id,
      type: task.type,
      status: task.status,
      progressPercent: task.progressPercent,
      progressMessage: task.progressMessage,
      errorMessage: task.errorMessage,
      retryCount: task.retryCount,
      lastRetriedAt: task.lastRetriedAt,
      canRetry: task.status === "failed" && task.type !== "signature_request",
      retryHint: taskRetryHint(task),
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      outputFileName: task.outputFile?.fileName ?? null,
      outputDownloadUrl:
        task.outputFile && isDownloadAvailable(task.outputFile)
          ? this.storageService.createDownloadUrl(task.outputFile.id)
          : null
    };
  }

  private mapWebhookDelivery(delivery: {
    id: string;
    eventType: string;
    status: string;
    responseStatus: number | null;
    errorMessage: string | null;
    attemptCount: number;
    deliveredAt: Date | null;
    createdAt: Date;
    endpoint: {
      id: string;
      url: string;
      active: boolean;
    };
  }): WebhookDeliveryItem {
    return {
      id: delivery.id,
      endpointId: delivery.endpoint.id,
      endpointUrl: delivery.endpoint.url,
      endpointActive: delivery.endpoint.active,
      eventType: delivery.eventType,
      status: delivery.status,
      responseStatus: delivery.responseStatus,
      errorMessage: delivery.errorMessage,
      attemptCount: delivery.attemptCount,
      deliveredAt: delivery.deliveredAt,
      createdAt: delivery.createdAt
    };
  }

  async activity(request: FastifyRequest): Promise<AccountActivity> {
    const user = await this.authService.requireUser(request);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [
      files,
      tasks,
      failedTasks,
      signatureEnvelopes,
      apiKeys,
      totalApiEvents,
      apiEventsLast30Days,
      recentApiEvents,
      webhookEndpoints,
      webhookDeliveries,
      storageAggregate,
      expiringSoonCount,
      largestFiles,
      retriedTaskCount
    ] = await Promise.all([
      this.prisma.fileObject.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.task.findMany({
        where: { ownerId: user.id },
        include: { outputFile: true },
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.task.findMany({
        where: { ownerId: user.id, status: "failed" },
        include: { outputFile: true },
        orderBy: { updatedAt: "desc" },
        take: 20
      }),
      this.prisma.signatureEnvelope.findMany({
        where: { ownerId: user.id },
        include: {
          sourceFile: true,
          finalFile: true
        },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.apiKey.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        include: {
          _count: {
            select: { usageEvents: true }
          }
        }
      }),
      this.prisma.apiUsageEvent.count({ where: { ownerId: user.id } }),
      this.prisma.apiUsageEvent.count({
        where: { ownerId: user.id, createdAt: { gte: thirtyDaysAgo } }
      }),
      this.prisma.apiUsageEvent.findMany({
        where: { ownerId: user.id },
        orderBy: { createdAt: "desc" },
        take: 25,
        include: {
          apiKey: {
            select: {
              name: true,
              keyPrefix: true
            }
          }
        }
      }),
      this.prisma.webhookEndpoint.findMany({
        where: { ownerId: user.id },
        select: {
          id: true,
          active: true
        }
      }),
      this.prisma.webhookDelivery.findMany({
        where: {
          endpoint: {
            ownerId: user.id
          }
        },
        include: {
          endpoint: {
            select: {
              id: true,
              url: true,
              active: true
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 25
      }),
      this.prisma.fileObject.aggregate({
        where: { ownerId: user.id },
        _count: { id: true },
        _sum: { sizeBytes: true }
      }),
      this.prisma.fileObject.count({
        where: {
          ownerId: user.id,
          expiresAt: {
            gt: new Date(),
            lte: soon
          }
        }
      }),
      this.prisma.fileObject.findMany({
        where: { ownerId: user.id },
        orderBy: { sizeBytes: "desc" },
        take: 5
      }),
      this.prisma.task.count({
        where: {
          ownerId: user.id,
          retryCount: { gt: 0 }
        }
      })
    ]);

    const fileItems = files.map((file) => this.mapFile(file));
    const taskItems = tasks.map((task) => this.mapTask(task));
    const failedTaskItems = failedTasks.map((task) => this.mapTask(task));

    return {
      files: fileItems,
      tasks: taskItems,
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
      })),
      storageUsage: {
        totalBytes: (storageAggregate._sum.sizeBytes ?? 0n).toString(),
        fileCount: storageAggregate._count.id,
        expiringSoonCount,
        largestFiles: largestFiles.map((file) => this.mapFile(file))
      },
      apiUsage: {
        apiKeyCount: apiKeys.length,
        activeApiKeyCount: apiKeys.filter(
          (key) => !key.revokedAt && (!key.expiresAt || key.expiresAt.getTime() > Date.now())
        ).length,
        totalEvents: totalApiEvents,
        eventsLast30Days: apiEventsLast30Days,
        keys: apiKeys.map((key) => ({
          id: key.id,
          name: key.name,
          keyPrefix: key.keyPrefix,
          lastUsedAt: key.lastUsedAt,
          expiresAt: key.expiresAt,
          revokedAt: key.revokedAt,
          createdAt: key.createdAt,
          usageCount: key._count.usageEvents
        })),
        recentEvents: recentApiEvents.map((event) => ({
          id: event.id,
          method: event.method,
          route: event.route,
          statusCode: event.statusCode,
          taskId: event.taskId,
          fileId: event.fileId,
          apiKeyName: event.apiKey?.name ?? null,
          apiKeyPrefix: event.apiKey?.keyPrefix ?? null,
          createdAt: event.createdAt
        }))
      },
      webhooks: {
        endpointCount: webhookEndpoints.length,
        activeEndpointCount: webhookEndpoints.filter((endpoint) => endpoint.active).length,
        deliveries: webhookDeliveries.map((delivery) => this.mapWebhookDelivery(delivery))
      },
      retryVisibility: {
        failedTaskCount: failedTaskItems.length,
        retriedTaskCount,
        tasks: failedTaskItems
      }
    };
  }

  async adminDashboard(request: FastifyRequest): Promise<AdminDashboard> {
    await this.authService.requireAdminUser(request);
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const now = new Date();
    const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const quotaBytes = BigInt(env.USER_STORAGE_QUOTA_MB) * 1024n * 1024n;

    const [
      users,
      fileAggregate,
      taskCount,
      apiKeyCount,
      webhookEndpointCount,
      webhookDeliveryCount,
      totalApiEvents,
      apiEventsLast30Days,
      recentApiEvents,
      recentWebhookDeliveries,
      recentFiles,
      failedTasks,
      recentJobs,
      taskStatusCounts,
      storageByOwner,
      expiring24hCount,
      expiring7dCount,
      expiredPendingDeletionCount,
      filesWithoutExpiryCount,
      oldestExpiry,
      auditEvents,
      deletionReceipts
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.fileObject.aggregate({
        _count: { id: true },
        _sum: { sizeBytes: true }
      }),
      this.prisma.task.count(),
      this.prisma.apiKey.count(),
      this.prisma.webhookEndpoint.count(),
      this.prisma.webhookDelivery.count(),
      this.prisma.apiUsageEvent.count(),
      this.prisma.apiUsageEvent.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      this.prisma.apiUsageEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 30,
        include: {
          owner: { select: { email: true } },
          apiKey: { select: { name: true } }
        }
      }),
      this.prisma.webhookDelivery.findMany({
        include: {
          endpoint: {
            select: {
              id: true,
              url: true,
              active: true,
              owner: {
                select: {
                  email: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 30
      }),
      this.prisma.fileObject.findMany({
        include: {
          owner: {
            select: { email: true }
          }
        },
        orderBy: { createdAt: "desc" },
        take: 30
      }),
      this.prisma.task.findMany({
        where: { status: "failed" },
        include: {
          outputFile: true,
          owner: {
            select: { email: true }
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 30
      }),
      this.prisma.task.findMany({
        include: {
          outputFile: true,
          owner: {
            select: { email: true }
          }
        },
        orderBy: { updatedAt: "desc" },
        take: 40
      }),
      this.prisma.task.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      this.prisma.fileObject.groupBy({
        by: ["ownerId"],
        _count: { _all: true },
        _sum: { sizeBytes: true }
      }),
      this.prisma.fileObject.count({
        where: { expiresAt: { gte: now, lte: next24Hours } }
      }),
      this.prisma.fileObject.count({
        where: { expiresAt: { gte: now, lte: next7Days } }
      }),
      this.prisma.fileObject.count({
        where: { expiresAt: { lt: now } }
      }),
      this.prisma.fileObject.count({
        where: { expiresAt: null }
      }),
      this.prisma.fileObject.findFirst({
        where: { expiresAt: { gte: now } },
        select: { expiresAt: true },
        orderBy: { expiresAt: "asc" }
      }),
      this.prisma.userSecurityEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 50
      }),
      this.prisma.fileDeletionReceipt.findMany({
        orderBy: { deletedAt: "desc" },
        take: 30
      })
    ]);

    const ownerIds = storageByOwner
      .map((item) => item.ownerId)
      .filter((ownerId): ownerId is string => Boolean(ownerId));
    const owners = ownerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, email: true }
        })
      : [];
    const ownerEmailById = new Map(owners.map((owner) => [owner.id, owner.email]));
    const queue = await this.queueService.getStatus().catch(() => null);

    return {
      generatedAt: new Date(),
      counts: {
        users,
        files: fileAggregate._count.id,
        tasks: taskCount,
        apiKeys: apiKeyCount,
        webhookEndpoints: webhookEndpointCount,
        webhookDeliveries: webhookDeliveryCount
      },
      storageUsage: {
        totalBytes: (fileAggregate._sum.sizeBytes ?? 0n).toString(),
        topOwners: storageByOwner
          .map((item) => ({
            ownerId: item.ownerId,
            ownerEmail: item.ownerId ? ownerEmailById.get(item.ownerId) ?? null : null,
            fileCount: item._count._all,
            totalBytes: (item._sum.sizeBytes ?? 0n).toString()
          }))
          .sort((left, right) => {
            const leftBytes = BigInt(left.totalBytes);
            const rightBytes = BigInt(right.totalBytes);
            return leftBytes > rightBytes ? -1 : leftBytes < rightBytes ? 1 : 0;
          })
          .slice(0, 10)
      },
      apiUsage: {
        totalEvents: totalApiEvents,
        eventsLast30Days: apiEventsLast30Days,
        recentEvents: recentApiEvents.map((event) => ({
          id: event.id,
          ownerEmail: event.owner.email,
          apiKeyName: event.apiKey?.name ?? null,
          method: event.method,
          route: event.route,
          statusCode: event.statusCode,
          taskId: event.taskId,
          fileId: event.fileId,
          createdAt: event.createdAt
        }))
      },
      webhookDeliveries: recentWebhookDeliveries.map((delivery) => this.mapWebhookDelivery(delivery)),
      taskRetryVisibility: {
        byStatus: taskStatusCounts.map((item) => ({ status: item.status, count: item._count._all })),
        queue,
        failedTasks: failedTasks.map((task) => ({
          ...this.mapTask(task),
          ownerEmail: task.owner?.email ?? null
        }))
      },
      retention: {
        expiring24hCount,
        expiring7dCount,
        expiredPendingDeletionCount,
        filesWithoutExpiryCount,
        oldestExpiryAt: oldestExpiry?.expiresAt ?? null,
        cleanupEnabled: env.CLEANUP_ENABLED,
        cleanupIntervalMinutes: env.CLEANUP_INTERVAL_MINUTES
      },
      antivirus: {
        enabled: env.ANTIVIRUS_ENABLED,
        engine: "Built-in upload signature scan",
        lastScanPolicy: env.ANTIVIRUS_ENABLED
          ? "Every accepted upload is scanned before the file record is created."
          : "Scanning is disabled by ANTIVIRUS_ENABLED."
      },
      storageQuotas: storageByOwner
        .map((item) => {
          const usedBytes = item._sum.sizeBytes ?? 0n;
          return {
            ownerId: item.ownerId,
            ownerEmail: item.ownerId ? ownerEmailById.get(item.ownerId) ?? null : null,
            usedBytes: usedBytes.toString(),
            quotaBytes: item.ownerId ? quotaBytes.toString() : "0",
            percentUsed: item.ownerId ? Math.min(100, Number((usedBytes * 10000n) / quotaBytes) / 100) : 0,
            fileCount: item._count._all
          };
        })
        .sort((left, right) => right.percentUsed - left.percentUsed)
        .slice(0, 12),
      auditLog: auditEvents.map((event) => ({
        id: event.id,
        type: event.type,
        email: event.email,
        actorEmail: event.actorEmail,
        ipAddress: event.ipAddress,
        description: event.description,
        createdAt: event.createdAt
      })),
      deletionReceipts: deletionReceipts.map((receipt) => ({
        id: receipt.id,
        fileId: receipt.fileId,
        fileName: receipt.fileName,
        ownerEmail: receipt.ownerEmail,
        sizeBytes: receipt.sizeBytes.toString(),
        reason: receipt.reason,
        storageDeleted: receipt.storageDeleted,
        storageError: receipt.storageError,
        expiresAt: receipt.expiresAt,
        deletedAt: receipt.deletedAt
      })),
      jobHistory: recentJobs.map((task) => ({
        ...this.mapTask(task),
        ownerEmail: task.owner?.email ?? null
      })),
      fileHistory: recentFiles.map((file) => ({
        ...this.mapFile(file),
        ownerEmail: file.owner?.email ?? null
      }))
    };
  }

  private mapAdminUser(user: {
    id: string;
    email: string;
    name: string | null;
    isAdmin: boolean;
    suspendedAt: Date | null;
    lockedAt: Date | null;
    lockReason: string | null;
    createdAt: Date;
    updatedAt: Date;
    securityEvents: Array<{
      id: string;
      type: UserSecurityEventType;
      description: string;
      ipAddress: string | null;
      userAgent: string | null;
      actorEmail: string | null;
      createdAt: Date;
    }>;
    _count: {
      files: number;
      tasks: number;
      apiKeys: number;
      sessions: number;
    };
  }): AdminUserManagementItem {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: user.isAdmin,
      suspendedAt: user.suspendedAt,
      lockedAt: user.lockedAt,
      lockReason: user.lockReason,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      counts: {
        files: user._count.files,
        tasks: user._count.tasks,
        apiKeys: user._count.apiKeys,
        sessions: user._count.sessions
      },
      recentSecurityEvents: user.securityEvents.map((event) => ({
        id: event.id,
        type: event.type,
        description: event.description,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent,
        actorEmail: event.actorEmail,
        createdAt: event.createdAt
      }))
    };
  }

  async listAdminUsers(request: FastifyRequest): Promise<AdminUserManagementItem[]> {
    await this.authService.requireAdminUser(request);
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        securityEvents: {
          orderBy: { createdAt: "desc" },
          take: 5
        },
        _count: {
          select: {
            files: true,
            tasks: true,
            apiKeys: true,
            sessions: {
              where: {
                revokedAt: null,
                expiresAt: { gt: new Date() }
              }
            }
          }
        }
      }
    });

    return users.map((user) => this.mapAdminUser(user));
  }

  async updateAdminUser(
    request: FastifyRequest,
    userId: string,
    input: { isAdmin?: boolean; suspended?: boolean; locked?: boolean; lockReason?: string }
  ): Promise<AdminUserManagementItem> {
    const admin = await this.authService.requireAdminUser(request);
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        securityEvents: {
          orderBy: { createdAt: "desc" },
          take: 5
        },
        _count: {
          select: {
            files: true,
            tasks: true,
            apiKeys: true,
            sessions: {
              where: {
                revokedAt: null,
                expiresAt: { gt: new Date() }
              }
            }
          }
        }
      }
    });

    if (!target) {
      throw new NotFoundException("User was not found.");
    }

    if (target.id === admin.id && input.suspended === true) {
      throw new BadRequestException("You cannot suspend your own admin account.");
    }

    if (target.id === admin.id && input.locked === true) {
      throw new BadRequestException("You cannot lock your own admin account.");
    }

    if (target.id === admin.id && input.isAdmin === false) {
      throw new BadRequestException("You cannot demote your own admin account.");
    }

    if (target.isAdmin && (input.isAdmin === false || input.locked === true || input.suspended === true)) {
      const adminCount = await this.prisma.user.count({
        where: {
          isAdmin: true,
          suspendedAt: null,
          lockedAt: null
        }
      });
      if (adminCount <= 1) {
        throw new BadRequestException("At least one active admin account is required.");
      }
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.user.update({
        where: { id: target.id },
        data: {
          isAdmin: input.isAdmin,
          suspendedAt: input.suspended === undefined ? undefined : input.suspended ? new Date() : null,
          lockedAt: input.locked === undefined ? undefined : input.locked ? new Date() : null,
          lockReason:
            input.locked === undefined
              ? undefined
              : input.locked
                ? input.lockReason?.trim() || "Locked by admin."
                : null
        },
        include: {
          securityEvents: {
            orderBy: { createdAt: "desc" },
            take: 5
          },
          _count: {
            select: {
              files: true,
              tasks: true,
              apiKeys: true,
              sessions: {
                where: {
                  revokedAt: null,
                  expiresAt: { gt: new Date() }
                }
              }
            }
          }
        }
      });

      if (input.suspended === true || input.isAdmin === false || input.locked === true) {
        await tx.userSession.updateMany({
          where: {
            userId: target.id,
            revokedAt: null
          },
          data: { revokedAt: new Date() }
        });
      }

      if (input.locked !== undefined) {
        await tx.userSecurityEvent.create({
          data: {
            userId: target.id,
            email: target.email,
            actorEmail: admin.email,
            type: input.locked ? UserSecurityEventType.account_locked : UserSecurityEventType.account_unlocked,
            ipAddress: requestIp(request),
            userAgent: requestUserAgent(request),
            description: input.locked
              ? `Account locked by ${admin.email}.`
              : `Account unlocked by ${admin.email}.`,
            metadata: input.locked
              ? {
                  reason: input.lockReason?.trim() || "Locked by admin."
                }
              : undefined
          }
        });
      }

      return next;
    });

    return this.mapAdminUser(updated);
  }

  async resetAdminUserPassword(
    request: FastifyRequest,
    userId: string,
    input: { password: string }
  ): Promise<{ ok: true }> {
    await this.authService.requireAdminUser(request);

    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundException("User was not found.");
    }
    this.authService.assertStrongPassword(input.password, target.email);

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash: await this.authService.hashPassword(input.password)
        }
      });
      await tx.userSession.updateMany({
        where: {
          userId: target.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });
    });

    return { ok: true };
  }

  async forceLogoutAdminUser(request: FastifyRequest, userId: string): Promise<{ ok: true; revokedSessions: number }> {
    const admin = await this.authService.requireAdminUser(request);
    const target = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw new NotFoundException("User was not found.");
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const revoked = await tx.userSession.updateMany({
        where: {
          userId: target.id,
          revokedAt: null
        },
        data: { revokedAt: new Date() }
      });

      await tx.userSecurityEvent.create({
        data: {
          userId: target.id,
          email: target.email,
          actorEmail: admin.email,
          type: UserSecurityEventType.sessions_revoked,
          ipAddress: requestIp(request),
          userAgent: requestUserAgent(request),
          description: `Active sessions force-logged out by ${admin.email}.`,
          metadata: {
            revokedSessions: revoked.count
          }
        }
      });

      return revoked;
    });

    return { ok: true, revokedSessions: result.count };
  }

  private async mapAdminApiKey(key: {
    id: string;
    name: string;
    keyPrefix: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    rateLimitedAt: Date | null;
    rateLimitReason: string | null;
    createdAt: Date;
    ownerId: string;
    owner: {
      email: string;
    };
    _count: {
      usageEvents: number;
    };
  }, since: Date): Promise<AdminApiKeyOversightItem> {
    const [last30Days, routeGroups] = await Promise.all([
      this.prisma.apiUsageEvent.count({
        where: {
          apiKeyId: key.id,
          createdAt: { gte: since }
        }
      }),
      this.prisma.apiUsageEvent.groupBy({
        by: ["route", "method"],
        where: { apiKeyId: key.id },
        _count: { _all: true },
        _max: { createdAt: true }
      })
    ]);

    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      ownerId: key.ownerId,
      ownerEmail: key.owner.email,
      lastUsedAt: key.lastUsedAt,
      expiresAt: key.expiresAt,
      revokedAt: key.revokedAt,
      rateLimitedAt: key.rateLimitedAt,
      rateLimitReason: key.rateLimitReason,
      createdAt: key.createdAt,
      usage: {
        total: key._count.usageEvents,
        last30Days,
        byRoute: routeGroups
          .map((group) => ({
            route: group.route,
            method: group.method,
            count: group._count._all,
            lastUsedAt: group._max.createdAt ?? key.createdAt
          }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 8)
      }
    };
  }

  async listAdminApiKeys(request: FastifyRequest): Promise<AdminApiKeyOversightItem[]> {
    await this.authService.requireAdminUser(request);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const keys = await this.prisma.apiKey.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: {
          select: { email: true }
        },
        _count: {
          select: { usageEvents: true }
        }
      }
    });

    return Promise.all(keys.map((key) => this.mapAdminApiKey(key, since)));
  }

  async updateAdminApiKey(
    request: FastifyRequest,
    keyId: string,
    input: { revoked?: boolean; rateLimited?: boolean; rateLimitReason?: string }
  ): Promise<AdminApiKeyOversightItem> {
    await this.authService.requireAdminUser(request);
    const existing = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!existing) {
      throw new NotFoundException("API key was not found.");
    }

    const updated = await this.prisma.apiKey.update({
      where: { id: existing.id },
      data: {
        revokedAt: input.revoked === undefined ? undefined : input.revoked ? existing.revokedAt ?? new Date() : null,
        rateLimitedAt:
          input.rateLimited === undefined ? undefined : input.rateLimited ? existing.rateLimitedAt ?? new Date() : null,
        rateLimitReason:
          input.rateLimited === undefined
            ? input.rateLimitReason?.trim() || undefined
            : input.rateLimited
              ? input.rateLimitReason?.trim() || "Rate limited by admin."
              : null
      },
      include: {
        owner: {
          select: { email: true }
        },
        _count: {
          select: { usageEvents: true }
        }
      }
    });

    return this.mapAdminApiKey(updated, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  }
}
