import { Module } from "@nestjs/common";
import { MailModule } from "../mail/mail.module.js";
import { FilesController } from "./files.controller.js";

@Module({
  imports: [MailModule],
  controllers: [FilesController]
})
export class FilesModule {}
