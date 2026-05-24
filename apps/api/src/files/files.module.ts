import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { FilesController } from "./files.controller.js";
import { PdfIntelligenceService } from "./pdf-intelligence.service.js";

@Module({
  imports: [MailModule],
  controllers: [FilesController],
  providers: [PdfIntelligenceService]
})
export class FilesModule {}
