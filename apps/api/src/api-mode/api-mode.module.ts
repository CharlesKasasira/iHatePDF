import { Module } from "@nestjs/common";
import { QueueModule } from "../queue/queue.module.js";
import { SignatureRequestsModule } from "../signature-requests/signature-requests.module.js";
import { TasksModule } from "../tasks/tasks.module.js";
import { UploadsModule } from "../uploads/uploads.module.js";
import { ApiKeysController } from "./api-keys.controller.js";
import { ApiV1Controller } from "./api-v1.controller.js";
import { WebhooksController } from "./webhooks.controller.js";
import { WebhooksModule } from "./webhooks.module.js";

@Module({
  imports: [QueueModule, TasksModule, UploadsModule, SignatureRequestsModule, WebhooksModule],
  controllers: [ApiKeysController, ApiV1Controller, WebhooksController],
  exports: [WebhooksModule]
})
export class ApiModeModule {}
