import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { SignatureRequestsController } from "./signature-requests.controller.js";
import { SignatureRequestsService } from "./signature-requests.service.js";

@Module({
  imports: [MailModule],
  controllers: [SignatureRequestsController],
  providers: [SignatureRequestsService]
})
export class SignatureRequestsModule {}
