import { Module } from "@nestjs/common";
import { WebhooksModule } from "../api-mode/webhooks.module.js";
import { MailModule } from "../mail/mail.module.js";
import { SignatureRequestsController } from "./signature-requests.controller.js";
import { SignatureRequestsService } from "./signature-requests.service.js";

@Module({
  imports: [MailModule, WebhooksModule],
  controllers: [SignatureRequestsController],
  providers: [SignatureRequestsService],
  exports: [SignatureRequestsService]
})
export class SignatureRequestsModule {}
