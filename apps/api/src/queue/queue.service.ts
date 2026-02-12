import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "../config/env.js";
import { PDF_TASK_QUEUE_NAME } from "./queue.constants.js";

export type PdfTaskJobName = "merge" | "split" | "sign";

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
  private readonly queue = new Queue(PDF_TASK_QUEUE_NAME, {
    connection: this.connection,
    defaultJobOptions: {
      removeOnComplete: 200,
      removeOnFail: 500
    }
  });

  enqueue<T>(name: PdfTaskJobName, payload: T): Promise<Job<T>> {
    return this.queue.add(name, payload);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
