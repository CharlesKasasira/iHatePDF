import { Injectable } from "@nestjs/common";
import type { TaskStatus, TaskType } from "@prisma/client";
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
  fileHistory: Array<AccountFileHistoryItem & { ownerEmail: string | null }>;
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
      taskStatusCounts,
      storageByOwner
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
      this.prisma.task.groupBy({
        by: ["status"],
        _count: { _all: true }
      }),
      this.prisma.fileObject.groupBy({
        by: ["ownerId"],
        _count: { _all: true },
        _sum: { sizeBytes: true }
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
      fileHistory: recentFiles.map((file) => ({
        ...this.mapFile(file),
        ownerEmail: file.owner?.email ?? null
      }))
    };
  }
}
