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
    return this.sendSigningInviteMail({
      to,
      signingLink,
      message
    });
  }

  async sendSigningInviteMail(input: {
    to: string;
    signingLink: string;
    title?: string;
    signerName?: string;
    role?: string;
    requesterEmail?: string;
    message?: string;
    expiresAt?: Date;
    routingOrder?: number;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: input.title ? `Signature request: ${input.title}` : "Signature request",
        text: [
          `You have a signature request${input.title ? ` for "${input.title}"` : ""}.`,
          input.signerName ? `Signer: ${input.signerName}` : null,
          input.role ? `Role: ${input.role}` : null,
          input.requesterEmail ? `Requested by: ${input.requesterEmail}` : null,
          typeof input.routingOrder === "number" ? `Signing order: ${input.routingOrder}` : null,
          input.expiresAt ? `Expires: ${input.expiresAt.toISOString()}` : null,
          `Open the secure link: ${input.signingLink}`,
          input.message ? `Message: ${input.message}` : null
        ]
          .filter(Boolean)
          .join("\n")
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send signature request email to ${input.to}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  async sendSigningReminderMail(input: {
    to: string;
    signingLink: string;
    title?: string;
    signerName?: string;
    role?: string;
    requesterEmail?: string;
    message?: string;
    expiresAt?: Date;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: input.title ? `Reminder: sign ${input.title}` : "Reminder: pending signature",
        text: [
          `This is a reminder to complete your signature request${input.title ? ` for "${input.title}"` : ""}.`,
          input.signerName ? `Signer: ${input.signerName}` : null,
          input.role ? `Role: ${input.role}` : null,
          input.requesterEmail ? `Requested by: ${input.requesterEmail}` : null,
          input.expiresAt ? `Expires: ${input.expiresAt.toISOString()}` : null,
          `Open the secure link: ${input.signingLink}`,
          input.message ? `Message: ${input.message}` : null
        ]
          .filter(Boolean)
          .join("\n")
      });
    } catch (error) {
      this.logger.warn(
        `Failed to send reminder email to ${input.to}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
