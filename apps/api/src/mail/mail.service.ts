import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const EAT_TIME_ZONE = "Africa/Kampala";
const eatDateFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: EAT_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

function formatEatDateTime(value: Date): string {
  return `${eatDateFormatter.format(value)} EAT`;
}

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

  private handleMailError(action: string, recipient: string, error: unknown): never {
    this.logger.warn(
      `Failed to ${action} email to ${recipient}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    throw new ServiceUnavailableException(`Failed to deliver ${action} email.`);
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
          "Hello,",
          "",
          `You have been asked to review and sign${input.title ? ` "${input.title}"` : " a document"}.`,
          input.signerName ? `Signer: ${input.signerName}` : null,
          input.role ? `Role: ${input.role}` : null,
          input.requesterEmail ? `Requested by: ${input.requesterEmail}` : null,
          typeof input.routingOrder === "number" ? `Signing order: ${input.routingOrder}` : null,
          input.expiresAt ? `Expires: ${formatEatDateTime(input.expiresAt)}` : null,
          "",
          "Use the secure link below to complete your assigned fields:",
          input.signingLink,
          input.message ? "" : null,
          input.message ? `Message from the requester: ${input.message}` : null,
          "",
          "Please complete this request before the expiry time.",
          "",
          "Regards,",
          "RENU 360"
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      });
    } catch (error) {
      this.handleMailError("signature request", input.to, error);
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
          "Hello,",
          "",
          `This is a reminder to complete your signature request${input.title ? ` for "${input.title}"` : ""}.`,
          input.signerName ? `Signer: ${input.signerName}` : null,
          input.role ? `Role: ${input.role}` : null,
          input.requesterEmail ? `Requested by: ${input.requesterEmail}` : null,
          input.expiresAt ? `Expires: ${formatEatDateTime(input.expiresAt)}` : null,
          "",
          "Use the secure link below to complete your assigned fields:",
          input.signingLink,
          input.message ? "" : null,
          input.message ? `Message from the requester: ${input.message}` : null,
          "",
          "Regards,",
          "RENU 360"
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      });
    } catch (error) {
      this.handleMailError("reminder", input.to, error);
    }
  }

  async sendSigningOtpMail(input: {
    to: string;
    otp: string;
    title?: string;
    requesterEmail?: string;
    expiresInMinutes: number;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: "Your iHatePDF signing verification code",
        text: [
          "Hello,",
          "",
          `Your signing verification code is ${input.otp}.`,
          input.title ? `Document: ${input.title}` : null,
          input.requesterEmail ? `Requested by: ${input.requesterEmail}` : null,
          `This code expires in ${input.expiresInMinutes} minutes.`,
          "",
          "If you did not expect this request, you can ignore this email.",
          "",
          "Regards,",
          "RENU 360"
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      });
    } catch (error) {
      this.handleMailError("signing verification", input.to, error);
    }
  }

  async sendPdfShareMail(input: {
    to: string;
    fileName: string;
    shareLink: string;
    message?: string;
    expiresAt: Date;
    mode?: "download" | "editor";
  }): Promise<void> {
    try {
      const isEditorInvite = input.mode === "editor";
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: isEditorInvite
          ? `PDF editor invitation: ${input.fileName}`
          : `PDF shared with you: ${input.fileName}`,
        text: [
          "Hello,",
          "",
          isEditorInvite
            ? `You have been invited to edit the PDF "${input.fileName}".`
            : `A PDF has been shared with you: "${input.fileName}".`,
          isEditorInvite
            ? "Use the editor invite link below:"
            : "Use the secure link below:",
          input.shareLink,
          `This link expires: ${formatEatDateTime(input.expiresAt)}`,
          input.message ? "" : null,
          input.message ? `Message from the sender: ${input.message}` : null,
          "",
          "Regards,",
          "RENU 360"
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      });
    } catch (error) {
      this.handleMailError("PDF share", input.to, error);
    }
  }

  async sendPasswordResetMail(input: {
    to: string;
    resetLink: string;
    name?: string;
    expiresInMinutes: number;
  }): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: env.MAIL_FROM,
        to: input.to,
        subject: "Reset your iHatePDF password",
        text: [
          input.name ? `Hello ${input.name},` : "Hello,",
          "",
          "A password reset was requested for your iHatePDF account.",
          "Use the secure link below to reset your password:",
          input.resetLink,
          `This link expires in ${input.expiresInMinutes} minutes.`,
          "",
          "If you did not request this, you can ignore this email.",
          "",
          "Regards,",
          "RENU 360"
        ].join("\n")
      });
    } catch (error) {
      this.handleMailError("password reset", input.to, error);
    }
  }
}
