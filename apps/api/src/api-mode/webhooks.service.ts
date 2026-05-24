import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import { createHmac, randomBytes } from "node:crypto";
import { AuthService } from "../auth/auth.service.js";
import { PrismaService } from "../prisma/prisma.service.js";

export const WEBHOOK_EVENTS = [
  "task.completed",
  "task.failed",
  "signing.envelope.created",
  "signing.envelope.finalizing",
  "signing.envelope.completed",
  "signing.envelope.finalization_failed",
  "signing.envelope.revoked",
  "signing.envelope.expired",
  "signing.recipient.completed",
  "signing.recipient.reminded",
  "signing.recipient.reassigned",
  "signing.notification_sent"
] as const;

const RESPONSE_BODY_LIMIT = 4096;

type WebhookDeliveryView = {
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

type WebhookDeliveryWithEndpoint = Prisma.WebhookDeliveryGetPayload<{
  include: {
    endpoint: {
      select: {
        id: true;
        url: true;
        active: true;
      };
    };
  };
}>;

type WebhookPayload = {
  id: string;
  type: string;
  createdAt: string;
  data: Prisma.InputJsonValue;
};

function createSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

function normalizeEvents(events?: string[]): string[] {
  const normalized = Array.from(new Set((events && events.length > 0 ? events : ["*"]).map((event) => event.trim())));
  return normalized.filter(Boolean);
}

function matchesEvent(events: Prisma.JsonValue, eventType: string): boolean {
  if (!Array.isArray(events)) {
    return false;
  }

  return events.includes("*") || events.includes(eventType);
}

function webhookSignature(secret: string, timestamp: string, body: string): string {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

@Injectable()
export class WebhooksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService
  ) {}

  async list(request: FastifyRequest) {
    const user = await this.authService.requireSessionUser(request);
    return this.prisma.webhookEndpoint.findMany({
      where: { ownerId: user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        url: true,
        description: true,
        events: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async listDeliveries(request: FastifyRequest, endpointId?: string) {
    const user = await this.authService.requireSessionUser(request);
    const deliveries = await this.prisma.webhookDelivery.findMany({
      where: {
        endpoint: {
          ownerId: user.id,
          id: endpointId
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
      take: 50
    });

    return deliveries.map((delivery) => this.mapDelivery(delivery));
  }

  async create(
    request: FastifyRequest,
    input: { url: string; description?: string; events?: string[] }
  ): Promise<{
    id: string;
    url: string;
    description: string | null;
    events: Prisma.JsonValue;
    active: boolean;
    signingSecret: string;
    createdAt: Date;
  }> {
    const user = await this.authService.requireSessionUser(request);
    const signingSecret = createSigningSecret();
    const endpoint = await this.prisma.webhookEndpoint.create({
      data: {
        ownerId: user.id,
        url: input.url.trim(),
        description: input.description?.trim() || null,
        events: normalizeEvents(input.events),
        signingSecret
      }
    });

    return {
      id: endpoint.id,
      url: endpoint.url,
      description: endpoint.description,
      events: endpoint.events,
      active: endpoint.active,
      signingSecret,
      createdAt: endpoint.createdAt
    };
  }

  async update(
    request: FastifyRequest,
    id: string,
    input: { url?: string; description?: string; events?: string[]; active?: boolean }
  ) {
    const user = await this.authService.requireSessionUser(request);
    const updated = await this.prisma.webhookEndpoint.updateMany({
      where: { id, ownerId: user.id },
      data: {
        url: input.url?.trim(),
        description: input.description === undefined ? undefined : input.description.trim() || null,
        events: input.events ? normalizeEvents(input.events) : undefined,
        active: input.active
      }
    });

    if (updated.count === 0) {
      throw new NotFoundException("Webhook endpoint not found.");
    }

    return this.prisma.webhookEndpoint.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        url: true,
        description: true,
        events: true,
        active: true,
        createdAt: true,
        updatedAt: true
      }
    });
  }

  async rotateSecret(
    request: FastifyRequest,
    id: string
  ): Promise<{ id: string; signingSecret: string }> {
    const user = await this.authService.requireSessionUser(request);
    const signingSecret = createSigningSecret();
    const updated = await this.prisma.webhookEndpoint.updateMany({
      where: { id, ownerId: user.id },
      data: { signingSecret }
    });

    if (updated.count === 0) {
      throw new NotFoundException("Webhook endpoint not found.");
    }

    return { id, signingSecret };
  }

  async delete(request: FastifyRequest, id: string): Promise<{ ok: true }> {
    const user = await this.authService.requireSessionUser(request);
    const deleted = await this.prisma.webhookEndpoint.deleteMany({
      where: { id, ownerId: user.id }
    });

    if (deleted.count === 0) {
      throw new NotFoundException("Webhook endpoint not found.");
    }

    return { ok: true };
  }

  async retryDelivery(request: FastifyRequest, deliveryId: string) {
    const user = await this.authService.requireSessionUser(request);
    const delivery = await this.prisma.webhookDelivery.findFirst({
      where: {
        id: deliveryId,
        endpoint: {
          ownerId: user.id
        }
      },
      include: {
        endpoint: true
      }
    });

    if (!delivery) {
      throw new NotFoundException("Webhook delivery not found.");
    }

    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: "pending",
        errorMessage: null,
        responseStatus: null,
        responseBody: null,
        deliveredAt: null
      }
    });

    await this.sendDelivery(
      delivery.id,
      {
        id: delivery.endpoint.id,
        url: delivery.endpoint.url,
        signingSecret: delivery.endpoint.signingSecret
      },
      delivery.payload as unknown as WebhookPayload,
      delivery.attemptCount + 1
    );

    const retried = await this.prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: delivery.id },
      include: {
        endpoint: {
          select: {
            id: true,
            url: true,
            active: true
          }
        }
      }
    });

    return this.mapDelivery(retried);
  }

  private mapDelivery(delivery: WebhookDeliveryWithEndpoint): WebhookDeliveryView {
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

  async dispatchForOwner(
    ownerId: string | null | undefined,
    eventType: string,
    data: Prisma.InputJsonValue
  ): Promise<void> {
    if (!ownerId) {
      return;
    }

    const endpoints = await this.prisma.webhookEndpoint.findMany({
      where: { ownerId, active: true }
    });

    const payload: WebhookPayload = {
      id: `evt_${randomBytes(16).toString("hex")}`,
      type: eventType,
      createdAt: new Date().toISOString(),
      data
    };

    await Promise.all(
      endpoints
        .filter((endpoint) => matchesEvent(endpoint.events, eventType))
        .map((endpoint) => this.deliver(endpoint, payload))
    );
  }

  private async deliver(
    endpoint: {
      id: string;
      url: string;
      signingSecret: string;
    },
    payload: WebhookPayload
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        endpointId: endpoint.id,
        eventType: payload.type,
        payload: payload as unknown as Prisma.InputJsonValue,
        status: "pending"
      }
    });

    await this.sendDelivery(delivery.id, endpoint, payload, 1);
  }

  private async sendDelivery(
    deliveryId: string,
    endpoint: {
      id: string;
      url: string;
      signingSecret: string;
    },
    payload: WebhookPayload,
    attemptCount: number
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));

    try {
      const response = await fetch(endpoint.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "iHatePDF-Webhooks/1.0",
          "X-IHatePDF-Delivery": deliveryId,
          "X-IHatePDF-Event": payload.type,
          "X-IHatePDF-Timestamp": timestamp,
          "X-IHatePDF-Signature": webhookSignature(endpoint.signingSecret, timestamp, body)
        },
        body,
        signal: AbortSignal.timeout(10_000)
      });
      const responseBody = (await response.text()).slice(0, RESPONSE_BODY_LIMIT);

      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: response.ok ? "delivered" : "failed",
          responseStatus: response.status,
          responseBody,
          attemptCount,
          deliveredAt: response.ok ? new Date() : null
        }
      });
    } catch (error) {
      await this.prisma.webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          attemptCount
        }
      });
    }
  }
}
