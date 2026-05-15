import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { env } from "../config/env.js";
import { PDF_TASK_QUEUE_NAME } from "./queue.constants.js";

export type PdfTaskJobName =
  | "merge"
  | "split"
  | "remove-pages"
  | "extract-pages"
  | "organize-pdf"
  | "sign"
  | "compress"
  | "protect"
  | "unlock"
  | "jpg-to-pdf"
  | "pdf-to-word"
  | "pdf-to-jpg"
  | "pdf-to-powerpoint"
  | "pdf-to-excel"
  | "word-to-pdf"
  | "excel-to-pdf"
  | "powerpoint-to-pdf"
  | "edit"
  | "image-tool"
  | "signature-request";

function redisConnectionOptions(redisUrl: string): {
  host: string;
  port: number;
  username?: string;
  password?: string;
  maxRetriesPerRequest: null;
} {
  const url = new URL(redisUrl);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    maxRetriesPerRequest: null
  };
}

@Injectable()
export class QueueService implements OnModuleDestroy {
  private queue: Queue | null = null;

  private getQueue(): Queue {
    if (!this.queue) {
      this.queue = new Queue(PDF_TASK_QUEUE_NAME, {
        connection: redisConnectionOptions(env.REDIS_URL),
        defaultJobOptions: {
          removeOnComplete: 200,
          removeOnFail: 500
        }
      });
    }

    return this.queue;
  }

  enqueue<T>(name: PdfTaskJobName, payload: T): Promise<Job<T>> {
    return this.getQueue().add(name, payload);
  }

  async getStatus(): Promise<{
    name: string;
    waiting: number;
    active: number;
    delayed: number;
    completed: number;
    failed: number;
    paused: number;
  }> {
    const counts = await this.getQueue().getJobCounts(
      "waiting",
      "active",
      "delayed",
      "completed",
      "failed",
      "paused"
    );

    return {
      name: PDF_TASK_QUEUE_NAME,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      completed: counts.completed ?? 0,
      failed: counts.failed ?? 0,
      paused: counts.paused ?? 0
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
