import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import { env } from "../config/env.js";
import { PDF_TASK_QUEUE_NAME } from "./queue.constants.js";

export type PdfTaskJobName = "merge" | "split" | "sign" | "compress" | "protect";

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

  async onModuleDestroy(): Promise<void> {
    if (this.queue) {
      await this.queue.close();
    }
  }
}
