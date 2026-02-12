import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: false,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? {
            user: env.SMTP_USER,
            pass: env.SMTP_PASS
          }
        : undefined
  });

  async sendSignatureRequestMail(to: string, signingLink: string, message?: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to,
        subject: "Signature request",
        text: `You have a signature request. Open this secure link: ${signingLink}${
          message ? `\n\nMessage: ${message}` : ""
        }`
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send signature request email to ${to}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
