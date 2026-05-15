import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException,
  UnauthorizedException
} from "@nestjs/common";
import {
  Prisma,
  SignatureEnvelopeEventType,
  SignatureEnvelopeRouting,
  SignatureEnvelopeStatus,
  SignatureFieldType,
  SignatureRecipientStatus,
  TaskType
} from "@prisma/client";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { WebhooksService } from "../api-mode/webhooks.service.js";
import { env } from "../config/env.js";
import { MailService } from "../mail/mail.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { QueueService } from "../queue/queue.service.js";
import { StorageService } from "../storage/storage.service.js";

interface CreateRecipientInput {
  key: string;
  name?: string;
  email: string;
  role?: string;
  routingOrder: number;
  passcode?: string;
}

interface CreateFieldInput {
  recipientKey: string;
  type: SignatureFieldType;
  label?: string;
  placeholder?: string;
  required?: boolean;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CreateSignatureEnvelopeInput {
  fileId: string;
  requesterEmail: string;
  title?: string;
  message?: string;
  outputName: string;
  routing: SignatureEnvelopeRouting;
  expiresAt?: string;
  recipients: CreateRecipientInput[];
  fields: CreateFieldInput[];
}

interface SubmittedFieldValueInput {
  fieldId: string;
  textValue?: string;
  checked?: boolean;
  signatureDataUrl?: string;
}

interface CompleteSignatureRequestInput {
  fieldValues: SubmittedFieldValueInput[];
}

interface ReassignRecipientInput {
  name?: string;
  email: string;
  role?: string;
}

export type SignatureRequestContext = {
  ownerId?: string;
};

export type SignatureRequestEvidence = {
  ipAddress?: string;
  userAgent?: string;
};

interface VerifyOtpInput {
  otp: string;
}

interface VerifyPasscodeInput {
  passcode: string;
}

interface SaveTemplateInput {
  name: string;
  title?: string;
  requesterEmail?: string;
  message?: string;
  outputName: string;
  routing: SignatureEnvelopeRouting;
  recipients: Array<{
    key: string;
    name?: string;
    email?: string;
    role?: string;
    routingOrder: number;
  }>;
  fields: CreateFieldInput[];
}

type EventMetadata = Prisma.InputJsonValue | undefined;

const scrypt = promisify(scryptCallback);
const SECRET_HASH_PREFIX = "scrypt";
const SECRET_SALT_BYTES = 16;
const SECRET_HASH_BYTES = 32;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;

const envelopeInclude = {
  sourceFile: true,
  finalFile: true,
  recipients: {
    orderBy: [{ routingOrder: "asc" }, { createdAt: "asc" }]
  },
  fields: {
    include: {
      recipient: true,
      value: true
    },
    orderBy: [{ page: "asc" }, { createdAt: "asc" }]
  },
  events: {
    include: {
      recipient: true
    },
    orderBy: {
      createdAt: "asc"
    }
  }
} satisfies Prisma.SignatureEnvelopeInclude;

type EnvelopeRecord = Prisma.SignatureEnvelopeGetPayload<{
  include: typeof envelopeInclude;
}>;

type RecipientSessionRecord = Prisma.SignatureEnvelopeRecipientGetPayload<{
  include: {
    envelope: {
      include: typeof envelopeInclude;
    };
  };
}>;

type TemplateRecord = Prisma.SignatureEnvelopeTemplateGetPayload<{
  include: {
    recipients: true;
    fields: {
      include: {
        recipient: true;
      };
    };
  };
}>;

interface FinalizeSignatureFieldPayload {
  fieldId: string;
  type: SignatureFieldType;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  label?: string;
  valueJson: Prisma.JsonObject;
}

interface FinalizeSignatureQueuePayload {
  taskId: string;
  envelopeId: string;
  fileKey: string;
  outputName: string;
  fields: FinalizeSignatureFieldPayload[];
}

function generateToken(): string {
  return randomBytes(24).toString("hex");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function normalizeOptionalString(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isRecipientOpen(status: SignatureRecipientStatus): boolean {
  return (
    status === SignatureRecipientStatus.waiting ||
    status === SignatureRecipientStatus.notified ||
    status === SignatureRecipientStatus.viewed
  );
}

function isEnvelopeOpen(status: SignatureEnvelopeStatus): boolean {
  return status === SignatureEnvelopeStatus.sent || status === SignatureEnvelopeStatus.in_progress;
}

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

@Injectable()
export class SignatureRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService,
    private readonly webhooksService: WebhooksService
  ) {}

  async createRequest(
    input: CreateSignatureEnvelopeInput,
    context: SignatureRequestContext = {},
    evidence: SignatureRequestEvidence = {}
  ): Promise<{
    id: string;
    status: SignatureEnvelopeStatus;
    routing: SignatureEnvelopeRouting;
    expiresAt: Date;
    manageUrl: string;
    signerLinks: Array<{
      recipientId: string;
      name: string | null;
      email: string;
      routingOrder: number;
      status: SignatureRecipientStatus;
      signingUrl: string;
    }>;
  }> {
    const file = await this.prisma.fileObject.findUnique({ where: { id: input.fileId } });
    if (!file) {
      throw new NotFoundException("Input file was not found.");
    }

    if (file.ownerId && file.ownerId !== context.ownerId) {
      throw new NotFoundException("Input file was not found.");
    }

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Signature workflows require a PDF input file.");
    }

    const recipients = await Promise.all(input.recipients.map(async (recipient) => ({
      key: recipient.key.trim(),
      name: normalizeOptionalString(recipient.name) ?? null,
      email: recipient.email.trim().toLowerCase(),
      role: normalizeOptionalString(recipient.role) ?? null,
      routingOrder: recipient.routingOrder,
      passcodeHash: recipient.passcode?.trim()
        ? await this.hashSecret(recipient.passcode.trim())
        : null
    })));

    if (recipients.length === 0) {
      throw new BadRequestException("Add at least one signer.");
    }

    const recipientKeySet = new Set<string>();
    for (const recipient of recipients) {
      if (!recipient.key) {
        throw new BadRequestException("Each signer needs a stable key.");
      }
      if (recipientKeySet.has(recipient.key)) {
        throw new BadRequestException(`Duplicate signer key "${recipient.key}".`);
      }
      recipientKeySet.add(recipient.key);
    }

    const fields = input.fields.map((field) => ({
      recipientKey: field.recipientKey.trim(),
      type: field.type,
      label: normalizeOptionalString(field.label) ?? null,
      placeholder: normalizeOptionalString(field.placeholder) ?? null,
      required: field.required ?? true,
      page: field.page,
      x: field.x,
      y: field.y,
      width: field.width,
      height: field.height
    }));

    if (fields.length === 0) {
      throw new BadRequestException("Add at least one signing field.");
    }

    for (const field of fields) {
      if (!recipientKeySet.has(field.recipientKey)) {
        throw new BadRequestException(`Field recipient "${field.recipientKey}" does not exist.`);
      }
    }

    const fileBuffer = await this.storageService.readObjectBuffer(file.objectKey);
    const pdf = await PDFDocument.load(fileBuffer);
    const pdfPageCount = pdf.getPageCount();

    for (const field of fields) {
      const pageIndex = field.page - 1;
      if (pageIndex < 0 || pageIndex >= pdfPageCount) {
        throw new BadRequestException(
          `Invalid page number ${field.page}. PDF has ${pdfPageCount} page(s).`
        );
      }

      const page = pdf.getPage(pageIndex);
      const { width: pageWidth, height: pageHeight } = page.getSize();
      if (field.x + field.width > pageWidth || field.y + field.height > pageHeight) {
        throw new BadRequestException(
          `Field "${field.label ?? field.type}" exceeds the bounds of page ${field.page}.`
        );
      }
    }

    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(Date.now() + env.SIGN_TOKEN_TTL_HOURS * 60 * 60 * 1000);
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("Expiration must be a future date.");
    }

    const activeOrder =
      input.routing === SignatureEnvelopeRouting.parallel
        ? null
        : Math.min(...recipients.map((recipient) => recipient.routingOrder));

    const envelope = await this.prisma.$transaction(async (tx) => {
      const createdEnvelope = await tx.signatureEnvelope.create({
        data: {
          title: normalizeOptionalString(input.title),
          requesterEmail: input.requesterEmail.trim().toLowerCase(),
          message: normalizeOptionalString(input.message),
          outputName: input.outputName.trim(),
          routing: input.routing,
          expiresAt,
          immutableAt: new Date(),
          sourceFileId: file.id,
          ownerId: context.ownerId ?? null
        }
      });

      const recipientByKey = new Map<string, string>();
      for (const recipient of recipients) {
        const createdRecipient = await tx.signatureEnvelopeRecipient.create({
          data: {
            envelopeId: createdEnvelope.id,
            token: generateToken(),
            name: recipient.name,
            email: recipient.email,
            role: recipient.role,
            routingOrder: recipient.routingOrder,
            passcodeHash: recipient.passcodeHash,
            status:
              input.routing === SignatureEnvelopeRouting.parallel ||
              recipient.routingOrder === activeOrder
                ? SignatureRecipientStatus.notified
                : SignatureRecipientStatus.waiting,
            notifiedAt:
              input.routing === SignatureEnvelopeRouting.parallel ||
              recipient.routingOrder === activeOrder
                ? new Date()
                : null
          }
        });
        recipientByKey.set(recipient.key, createdRecipient.id);
      }

      for (const field of fields) {
        const recipientId = recipientByKey.get(field.recipientKey);
        if (!recipientId) {
          throw new BadRequestException(`Field recipient "${field.recipientKey}" was not created.`);
        }

        await tx.signatureEnvelopeField.create({
          data: {
            envelopeId: createdEnvelope.id,
            recipientId,
            type: field.type,
            label: field.label,
            placeholder: field.placeholder,
            required: field.required,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height
          }
        });
      }

      await this.logEvent(tx, {
        envelopeId: createdEnvelope.id,
        type: SignatureEnvelopeEventType.created,
        actorEmail: createdEnvelope.requesterEmail,
        description: `Signing workflow created with ${recipients.length} signer(s) and ${fields.length} field(s).`,
        metadata: {
          routing: input.routing,
          recipientCount: recipients.length,
          fieldCount: fields.length
        },
        evidence
      });

      return tx.signatureEnvelope.findUniqueOrThrow({
        where: { id: createdEnvelope.id },
        include: envelopeInclude
      });
    });

    await this.notifyRecipientsForCurrentTurn(envelope, false);
    await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.envelope.created", {
      envelopeId: envelope.id,
      status: envelope.status,
      routing: envelope.routing,
      recipientCount: envelope.recipients.length,
      fieldCount: envelope.fields.length,
      createdAt: envelope.createdAt.toISOString()
    });

    return this.mapEnvelopeCreationResponse(envelope);
  }

  async getEnvelope(
    id: string,
    context: SignatureRequestContext = {}
  ): Promise<ReturnType<SignatureRequestsService["mapEnvelopeView"]>> {
    const envelope = await this.loadEnvelopeById(id, context);
    return this.mapEnvelopeView(envelope);
  }

  async requestOtp(
    token: string,
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true; expiresAt: Date }> {
    const session = await this.loadRecipientSession(token);
    this.assertCanVerify(session);

    if (session.otpVerifiedAt) {
      return { ok: true, expiresAt: session.otpExpiresAt ?? new Date() };
    }

    const otp = generateOtp();
    const otpHash = await this.hashSecret(otp);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: session.id },
        data: {
          otpHash,
          otpExpiresAt: expiresAt,
          otpAttemptCount: 0
        }
      });

      await this.logEvent(tx, {
        envelopeId: session.envelopeId,
        recipientId: session.id,
        type: SignatureEnvelopeEventType.otp_requested,
        actorEmail: session.email,
        description: `Email verification code sent to ${session.email}.`,
        evidence
      });
    });

    await this.mailService.sendSigningOtpMail({
      to: session.email,
      otp,
      title: session.envelope.title ?? session.envelope.sourceFile.fileName,
      requesterEmail: session.envelope.requesterEmail,
      expiresInMinutes: OTP_TTL_MINUTES
    });

    return { ok: true, expiresAt };
  }

  async verifyOtp(
    token: string,
    input: VerifyOtpInput,
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true; verification: ReturnType<SignatureRequestsService["mapVerificationState"]> }> {
    const session = await this.loadRecipientSession(token);
    this.assertCanVerify(session);

    if (!session.otpHash || !session.otpExpiresAt) {
      throw new BadRequestException("Request an email verification code first.");
    }

    if (session.otpExpiresAt.getTime() <= Date.now()) {
      await this.logVerificationFailure(session, SignatureEnvelopeEventType.otp_failed, "Email verification code expired.", evidence);
      throw new BadRequestException("Email verification code has expired.");
    }

    if (session.otpAttemptCount >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException("Too many verification attempts. Request a new code.");
    }

    const isValid = await this.verifySecret(input.otp.trim(), session.otpHash);
    if (!isValid) {
      await this.prisma.$transaction(async (tx) => {
        await tx.signatureEnvelopeRecipient.update({
          where: { id: session.id },
          data: {
            otpAttemptCount: {
              increment: 1
            }
          }
        });
        await this.logEvent(tx, {
          envelopeId: session.envelopeId,
          recipientId: session.id,
          type: SignatureEnvelopeEventType.otp_failed,
          actorEmail: session.email,
          description: "Email verification code was rejected.",
          evidence
        });
      });
      throw new UnauthorizedException("Invalid email verification code.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: session.id },
        data: {
          otpVerifiedAt: new Date(),
          otpAttemptCount: 0
        }
      });
      await this.logEvent(tx, {
        envelopeId: session.envelopeId,
        recipientId: session.id,
        type: SignatureEnvelopeEventType.otp_verified,
        actorEmail: session.email,
        description: `${session.email} verified email ownership.`,
        evidence
      });
    });

    const refreshed = await this.loadRecipientSession(token);
    if (this.isIdentityVerified(refreshed)) {
      await this.markViewedIfNeeded(refreshed, evidence);
    }

    return {
      ok: true,
      verification: this.mapVerificationState(await this.loadRecipientSession(token))
    };
  }

  async verifyPasscode(
    token: string,
    input: VerifyPasscodeInput,
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true; verification: ReturnType<SignatureRequestsService["mapVerificationState"]> }> {
    const session = await this.loadRecipientSession(token);
    this.assertCanVerify(session);

    if (!session.otpVerifiedAt) {
      throw new BadRequestException("Verify your email code before entering the passcode.");
    }

    if (!session.passcodeHash) {
      return { ok: true, verification: this.mapVerificationState(session) };
    }

    const isValid = await this.verifySecret(input.passcode.trim(), session.passcodeHash);
    if (!isValid) {
      await this.logVerificationFailure(session, SignatureEnvelopeEventType.passcode_failed, "Signer passcode was rejected.", evidence);
      throw new UnauthorizedException("Invalid signer passcode.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: session.id },
        data: {
          passcodeVerifiedAt: new Date()
        }
      });
      await this.logEvent(tx, {
        envelopeId: session.envelopeId,
        recipientId: session.id,
        type: SignatureEnvelopeEventType.passcode_verified,
        actorEmail: session.email,
        description: `${session.name ?? session.email} verified the signing passcode.`,
        evidence
      });
    });

    const refreshed = await this.loadRecipientSession(token);
    await this.markViewedIfNeeded(refreshed, evidence);

    return {
      ok: true,
      verification: this.mapVerificationState(await this.loadRecipientSession(token))
    };
  }

  async retryFinalization(
    envelopeId: string,
    context: SignatureRequestContext = {},
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ envelopeId: string; taskId: string }> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    if (envelope.status !== SignatureEnvelopeStatus.finalization_failed) {
      throw new BadRequestException("Only workflows with failed finalization can be retried.");
    }

    if (envelope.recipients.some((recipient) => recipient.status !== SignatureRecipientStatus.completed)) {
      throw new BadRequestException("All signers must be completed before finalization can be retried.");
    }

    const finalizeFields = this.buildFinalizeFields(
      envelope.fields.map((field) => ({
        field,
        valueJson: field.value ? (field.value.valueJson as Prisma.JsonObject) : null
      }))
    );

    const { taskId, queuePayload } = await this.prisma.$transaction(async (tx) => {
      const task = await tx.task.create({
        data: {
          type: TaskType.signature_request,
          status: "queued",
          inputFileId: envelope.sourceFileId,
          ownerId: envelope.ownerId,
          payload: ({
            envelopeId: envelope.id,
            fileKey: envelope.sourceFile.objectKey,
            outputName: envelope.outputName,
            fields: finalizeFields
          } as unknown) as Prisma.InputJsonObject
        }
      });

      await tx.signatureEnvelope.update({
        where: { id: envelope.id },
        data: {
          status: SignatureEnvelopeStatus.finalizing,
          finalTaskId: task.id
        }
      });

      await this.logEvent(tx, {
        envelopeId: envelope.id,
        type: SignatureEnvelopeEventType.finalized,
        actorEmail: envelope.requesterEmail,
        description: "Retrying final signed PDF rendering after a previous failure.",
        metadata: {
          taskId: task.id
        },
        evidence
      });

      return {
        taskId: task.id,
        queuePayload: {
          taskId: task.id,
          envelopeId: envelope.id,
          fileKey: envelope.sourceFile.objectKey,
          outputName: envelope.outputName,
          fields: finalizeFields
        } satisfies FinalizeSignatureQueuePayload
      };
    });

    await this.enqueueFinalizationOrMarkFailure(queuePayload);
    return { envelopeId: envelope.id, taskId };
  }

  async getByToken(token: string, evidence: SignatureRequestEvidence = {}): Promise<{
    envelopeId: string;
    title: string | null;
    requesterEmail: string;
    status: SignatureEnvelopeStatus;
    routing: SignatureEnvelopeRouting;
    fileId: string | null;
    fileName: string;
    message: string | null;
    expiresAt: Date;
    currentOrder: number | null;
    canSubmit: boolean;
    verification: {
      otpRequired: boolean;
      otpVerified: boolean;
      passcodeRequired: boolean;
      passcodeVerified: boolean;
      identityVerified: boolean;
      otpExpiresAt: Date | null;
    };
    recipient: {
      id: string;
      name: string | null;
      email: string;
      role: string | null;
      routingOrder: number;
      status: SignatureRecipientStatus;
    };
    recipients: Array<{
      id: string;
      name: string | null;
      email: string;
      role: string | null;
      routingOrder: number;
      status: SignatureRecipientStatus;
      completedAt: Date | null;
    }>;
    fields: Array<{
      id: string;
      recipientId: string;
      recipientName: string | null;
      type: SignatureFieldType;
      label: string | null;
      placeholder: string | null;
      required: boolean;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      value: Prisma.JsonObject | null;
    }>;
    auditTrail: Array<{
      id: string;
      type: SignatureEnvelopeEventType;
      actorEmail: string | null;
      description: string;
      createdAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
    finalDownloadUrl: string | null;
    auditCertificateUrl: string | null;
  }> {
    const session = await this.loadRecipientSession(token);
    const identityVerified = this.isIdentityVerified(session);
    const isActiveTurn = this.isRecipientActiveTurn(session, session.envelope);
    const canSubmit =
      identityVerified &&
      isActiveTurn &&
      isEnvelopeOpen(session.envelope.status) &&
      session.status !== SignatureRecipientStatus.completed;

    if (canSubmit) {
      await this.markViewedIfNeeded(session, evidence);
    }

    const refreshed = await this.loadRecipientSession(token);
    const refreshedIdentityVerified = this.isIdentityVerified(refreshed);

    return {
      envelopeId: refreshed.envelope.id,
      title: refreshed.envelope.title,
      requesterEmail: refreshed.envelope.requesterEmail,
      status: refreshed.envelope.status,
      routing: refreshed.envelope.routing,
      fileId: refreshedIdentityVerified ? refreshed.envelope.sourceFileId : null,
      fileName: refreshed.envelope.sourceFile.fileName,
      message: refreshed.envelope.message,
      expiresAt: refreshed.envelope.expiresAt,
      currentOrder: this.getCurrentRoutingOrder(refreshed.envelope),
      canSubmit:
        refreshedIdentityVerified &&
        this.isRecipientActiveTurn(refreshed, refreshed.envelope) &&
        isEnvelopeOpen(refreshed.envelope.status) &&
        refreshed.status !== SignatureRecipientStatus.completed,
      verification: this.mapVerificationState(refreshed),
      recipient: {
        id: refreshed.id,
        name: refreshed.name,
        email: refreshed.email,
        role: refreshed.role,
        routingOrder: refreshed.routingOrder,
        status: refreshed.status
      },
      recipients: refreshed.envelope.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        routingOrder: recipient.routingOrder,
        status: recipient.status,
        completedAt: recipient.completedAt
      })),
      fields: refreshedIdentityVerified ? refreshed.envelope.fields.map((field) => ({
        id: field.id,
        recipientId: field.recipientId,
        recipientName: field.recipient.name,
        type: field.type,
        label: field.label,
        placeholder: field.placeholder,
        required: field.required,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        value: field.value ? (field.value.valueJson as Prisma.JsonObject) : null
      })) : [],
      auditTrail: refreshed.envelope.events.map((event) => ({
        id: event.id,
        type: event.type,
        actorEmail: event.actorEmail,
        description: event.description,
        createdAt: event.createdAt,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent
      })),
      finalDownloadUrl: refreshedIdentityVerified && refreshed.envelope.finalFileId
        ? `${env.API_PUBLIC_URL}/api/files/signature-requests/${encodeURIComponent(token)}/final-download`
        : null,
      auditCertificateUrl: refreshedIdentityVerified && refreshed.envelope.finalFileId
        ? `${env.API_PUBLIC_URL}/api/signature-requests/${encodeURIComponent(token)}/audit-certificate`
        : null
    };
  }

  async completeByToken(
    token: string,
    payload: CompleteSignatureRequestInput,
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ envelopeId: string; status: SignatureEnvelopeStatus; taskId?: string }> {
    const session = await this.loadRecipientSession(token);

    if (!isEnvelopeOpen(session.envelope.status)) {
      if (session.envelope.status === SignatureEnvelopeStatus.expired) {
        throw new GoneException("This signing workflow has expired.");
      }
      throw new BadRequestException("This signing workflow is no longer open.");
    }

    if (!this.isRecipientActiveTurn(session, session.envelope)) {
      throw new BadRequestException("This signer is not active yet. A previous signer must complete first.");
    }

    if (session.status === SignatureRecipientStatus.completed) {
      throw new BadRequestException("This signer has already completed their fields.");
    }

    if (!this.isIdentityVerified(session)) {
      throw new UnauthorizedException("Verify your email before submitting signature fields.");
    }

    const assignedFields = session.envelope.fields.filter((field) => field.recipientId === session.id);
    if (assignedFields.length === 0) {
      throw new BadRequestException("No fields are assigned to this signer.");
    }

    const submittedByFieldId = new Map(payload.fieldValues.map((item) => [item.fieldId, item]));
    const normalizedValues = new Map<string, Prisma.JsonObject>();

    for (const field of assignedFields) {
      const submitted = submittedByFieldId.get(field.id);
      const normalized = this.normalizeSubmittedFieldValue(field.type, submitted);
      if (!normalized && field.required) {
        throw new BadRequestException(`Field "${field.label ?? field.type}" is required.`);
      }
      if (normalized) {
        normalizedValues.set(field.id, normalized);
      }
    }

    const incompleteRequiredField = assignedFields.find(
      (field) => field.required && !normalizedValues.has(field.id)
    );
    if (incompleteRequiredField) {
      throw new BadRequestException(
        `Field "${incompleteRequiredField.label ?? incompleteRequiredField.type}" is required.`
      );
    }

    const allFieldsWithCurrentValues = session.envelope.fields.map((field) => ({
      field,
      valueJson:
        field.recipientId === session.id
          ? normalizedValues.get(field.id) ?? null
          : field.value
            ? (field.value.valueJson as Prisma.JsonObject)
            : null
    }));

    const remainingRecipients = session.envelope.recipients.filter(
      (recipient) => recipient.id !== session.id && recipient.status !== SignatureRecipientStatus.completed
    );
    const isFinalSigner = remainingRecipients.length === 0;
    const now = new Date();

    let nextRecipients: EnvelopeRecord["recipients"] = [];
    let finalTaskId: string | undefined;
    let finalizationPayload: FinalizeSignatureQueuePayload | undefined;

    await this.prisma.$transaction(async (tx) => {
      for (const field of assignedFields) {
        const valueJson = normalizedValues.get(field.id);
        if (!valueJson) {
          continue;
        }

        await tx.signatureEnvelopeFieldValue.upsert({
          where: {
            fieldId: field.id
          },
          update: {
            recipientId: session.id,
            envelopeId: session.envelope.id,
            valueJson,
            completedAt: now
          },
          create: {
            fieldId: field.id,
            recipientId: session.id,
            envelopeId: session.envelope.id,
            valueJson,
            completedAt: now
          }
        });
      }

      await tx.signatureEnvelopeRecipient.update({
        where: { id: session.id },
        data: {
          status: SignatureRecipientStatus.completed,
          completedAt: now,
          lastViewedAt: now
        }
      });

      await this.logEvent(tx, {
        envelopeId: session.envelope.id,
        recipientId: session.id,
        type: SignatureEnvelopeEventType.completed,
        actorEmail: session.email,
        description: `${session.name ?? session.email} completed their assigned fields.`,
        metadata: {
          fieldCount: assignedFields.length
        },
        evidence
      });

      if (isFinalSigner) {
        const finalizeFields = this.buildFinalizeFields(allFieldsWithCurrentValues);

        const task = await tx.task.create({
          data: {
            type: TaskType.signature_request,
            status: "queued",
            inputFileId: session.envelope.sourceFileId,
            ownerId: session.envelope.ownerId,
            payload: ({
              envelopeId: session.envelope.id,
              fileKey: session.envelope.sourceFile.objectKey,
              outputName: session.envelope.outputName,
              fields: finalizeFields
            } as unknown) as Prisma.InputJsonObject
          }
        });

        finalTaskId = task.id;

        await tx.signatureEnvelope.update({
          where: { id: session.envelope.id },
          data: {
            status: SignatureEnvelopeStatus.finalizing,
            finalTaskId: task.id
          }
        });

        await this.logEvent(tx, {
          envelopeId: session.envelope.id,
          type: SignatureEnvelopeEventType.finalized,
          actorEmail: session.email,
          description: "All signers completed. Final signed PDF is being rendered.",
          metadata: {
            taskId: task.id
          }
        });

        finalizationPayload = {
          taskId: task.id,
          envelopeId: session.envelope.id,
          fileKey: session.envelope.sourceFile.objectKey,
          outputName: session.envelope.outputName,
          fields: finalizeFields
        };
      } else {
        let updatedEnvelopeStatus = SignatureEnvelopeStatus.in_progress;
        if (session.envelope.status === SignatureEnvelopeStatus.sent) {
          updatedEnvelopeStatus = SignatureEnvelopeStatus.in_progress;
        }

        if (session.envelope.routing === SignatureEnvelopeRouting.sequential) {
          const nextOrder = this.findNextOpenRoutingOrder(session.envelope.recipients, session.routingOrder);
          if (nextOrder !== null) {
            await tx.signatureEnvelopeRecipient.updateMany({
              where: {
                envelopeId: session.envelope.id,
                routingOrder: nextOrder,
                status: SignatureRecipientStatus.waiting
              },
              data: {
                status: SignatureRecipientStatus.notified,
                notifiedAt: now
              }
            });
          }
        }

        await tx.signatureEnvelope.update({
          where: { id: session.envelope.id },
          data: {
            status: updatedEnvelopeStatus,
            startedAt: session.envelope.startedAt ?? now
          }
        });
      }
    });

    if (finalizationPayload) {
      await this.enqueueFinalizationOrMarkFailure(finalizationPayload);
    }

    if (!isFinalSigner) {
      const refreshedEnvelope = await this.loadEnvelopeById(session.envelope.id);
      nextRecipients = this.getCurrentTurnRecipients(refreshedEnvelope).filter(
        (recipient) => recipient.id !== session.id
      );
      if (nextRecipients.length > 0) {
        await this.notifyRecipientsForCurrentTurn(refreshedEnvelope, false, nextRecipients);
      }
    }

    const refreshedEnvelope = await this.loadEnvelopeById(session.envelope.id);
    await this.webhooksService.dispatchForOwner(refreshedEnvelope.ownerId, "signing.recipient.completed", {
      envelopeId: refreshedEnvelope.id,
      recipientId: session.id,
      recipientEmail: session.email,
      status: refreshedEnvelope.status,
      completedAt: now.toISOString()
    });

    if (finalTaskId) {
      await this.webhooksService.dispatchForOwner(refreshedEnvelope.ownerId, "signing.envelope.finalizing", {
        envelopeId: refreshedEnvelope.id,
        taskId: finalTaskId,
        status: refreshedEnvelope.status
      });
    }

    return {
      envelopeId: refreshedEnvelope.id,
      status: refreshedEnvelope.status,
      taskId: finalTaskId
    };
  }

  async remindRecipient(
    envelopeId: string,
    recipientId: string,
    context: SignatureRequestContext = {},
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true }> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    this.assertEnvelopeManageable(envelope);

    const recipient = envelope.recipients.find((item) => item.id === recipientId);
    if (!recipient) {
      throw new NotFoundException("Signer not found.");
    }

    if (!this.isRecipientActiveTurn(recipient, envelope)) {
      throw new BadRequestException("Only the current signer can be reminded.");
    }

    if (recipient.status === SignatureRecipientStatus.completed) {
      throw new BadRequestException("Completed signers cannot be reminded.");
    }

    await this.mailService.sendSigningReminderMail({
      to: recipient.email,
      signerName: recipient.name ?? undefined,
      role: recipient.role ?? undefined,
      signingLink: this.buildSigningLink(recipient.token),
      title: envelope.title ?? envelope.sourceFile.fileName,
      requesterEmail: envelope.requesterEmail,
      message: envelope.message ?? undefined,
      expiresAt: envelope.expiresAt
    });

    const remindedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: recipient.id },
        data: {
          remindedAt,
          reminderCount: {
            increment: 1
          }
        }
      });

      await this.logEvent(tx, {
        envelopeId,
        recipientId,
        type: SignatureEnvelopeEventType.reminded,
        actorEmail: envelope.requesterEmail,
        description: `Reminder sent to ${recipient.name ?? recipient.email}.`,
        evidence
      });
    });

    await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.recipient.reminded", {
      envelopeId,
      recipientId,
      recipientEmail: recipient.email,
      remindedAt: remindedAt.toISOString()
    });

    return { ok: true };
  }

  async reassignRecipient(
    envelopeId: string,
    recipientId: string,
    input: ReassignRecipientInput,
    context: SignatureRequestContext = {},
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true; signingUrl: string }> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    this.assertEnvelopeManageable(envelope);

    const recipient = envelope.recipients.find((item) => item.id === recipientId);
    if (!recipient) {
      throw new NotFoundException("Signer not found.");
    }

    if (recipient.status === SignatureRecipientStatus.completed) {
      throw new BadRequestException("Completed signers cannot be reassigned.");
    }

    const isActiveTurn = this.isRecipientActiveTurn(recipient, envelope);
    const nextToken = generateToken();
    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: recipient.id },
        data: {
          token: nextToken,
          name: normalizeOptionalString(input.name) ?? null,
          email: input.email.trim().toLowerCase(),
          role: normalizeOptionalString(input.role) ?? null,
          status: isActiveTurn ? SignatureRecipientStatus.notified : SignatureRecipientStatus.waiting,
          notifiedAt: isActiveTurn ? new Date() : null,
          lastViewedAt: null,
          remindedAt: null
        }
      });

      await this.logEvent(tx, {
        envelopeId,
        recipientId,
        type: SignatureEnvelopeEventType.reassigned,
        actorEmail: envelope.requesterEmail,
        description: `${recipient.name ?? recipient.email} was reassigned to ${input.email.trim().toLowerCase()}.`,
        metadata: {
          previousEmail: recipient.email,
          nextEmail: input.email.trim().toLowerCase()
        },
        evidence
      });
    });

    if (isActiveTurn) {
      await this.mailService.sendSigningInviteMail({
        to: input.email.trim().toLowerCase(),
        signerName: normalizeOptionalString(input.name),
        role: normalizeOptionalString(input.role),
        signingLink: this.buildSigningLink(nextToken),
        title: envelope.title ?? envelope.sourceFile.fileName,
        requesterEmail: envelope.requesterEmail,
        message: envelope.message ?? undefined,
        expiresAt: envelope.expiresAt,
        routingOrder: recipient.routingOrder
      });
    }

    await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.recipient.reassigned", {
      envelopeId,
      recipientId,
      previousEmail: recipient.email,
      nextEmail: input.email.trim().toLowerCase()
    });

    return {
      ok: true,
      signingUrl: this.buildSigningLink(nextToken)
    };
  }

  async revokeEnvelope(
    envelopeId: string,
    context: SignatureRequestContext = {},
    evidence: SignatureRequestEvidence = {}
  ): Promise<{ ok: true }> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    this.assertEnvelopeManageable(envelope);

    const revokedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelope.update({
        where: { id: envelope.id },
        data: {
          status: SignatureEnvelopeStatus.revoked,
          revokedAt
        }
      });

      await tx.signatureEnvelopeRecipient.updateMany({
        where: {
          envelopeId: envelope.id,
          status: {
            in: [
              SignatureRecipientStatus.waiting,
              SignatureRecipientStatus.notified,
              SignatureRecipientStatus.viewed
            ]
          }
        },
        data: {
          status: SignatureRecipientStatus.revoked
        }
      });

      await this.logEvent(tx, {
        envelopeId: envelope.id,
        type: SignatureEnvelopeEventType.revoked,
        actorEmail: envelope.requesterEmail,
        description: "Signing workflow revoked by the sender.",
        evidence
      });
    });

    await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.envelope.revoked", {
      envelopeId: envelope.id,
      status: SignatureEnvelopeStatus.revoked,
      revokedAt: revokedAt.toISOString()
    });

    return { ok: true };
  }

  async listTemplates(context: SignatureRequestContext): Promise<Array<ReturnType<SignatureRequestsService["mapTemplate"]>>> {
    if (!context.ownerId) {
      throw new UnauthorizedException("Sign in to use envelope templates.");
    }

    const templates = await this.prisma.signatureEnvelopeTemplate.findMany({
      where: { ownerId: context.ownerId },
      include: {
        recipients: { orderBy: [{ routingOrder: "asc" }, { createdAt: "asc" }] },
        fields: { include: { recipient: true }, orderBy: [{ page: "asc" }, { createdAt: "asc" }] }
      },
      orderBy: { createdAt: "desc" }
    });

    return templates.map((template) => this.mapTemplate(template));
  }

  async createTemplate(input: SaveTemplateInput, context: SignatureRequestContext): Promise<ReturnType<SignatureRequestsService["mapTemplate"]>> {
    if (!context.ownerId) {
      throw new UnauthorizedException("Sign in to save envelope templates.");
    }

    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.signatureEnvelopeTemplate.create({
        data: {
          ownerId: context.ownerId!,
          name: input.name.trim(),
          title: normalizeOptionalString(input.title) ?? null,
          requesterEmail: normalizeOptionalString(input.requesterEmail)?.toLowerCase() ?? null,
          message: normalizeOptionalString(input.message) ?? null,
          outputName: input.outputName.trim(),
          routing: input.routing
        }
      });

      const recipientByKey = new Map<string, string>();
      for (const recipient of input.recipients) {
        const createdRecipient = await tx.signatureEnvelopeTemplateRecipient.create({
          data: {
            templateId: created.id,
            key: recipient.key.trim(),
            name: normalizeOptionalString(recipient.name) ?? null,
            email: normalizeOptionalString(recipient.email)?.toLowerCase() ?? null,
            role: normalizeOptionalString(recipient.role) ?? null,
            routingOrder: recipient.routingOrder
          }
        });
        recipientByKey.set(recipient.key.trim(), createdRecipient.id);
      }

      for (const field of input.fields) {
        const recipientId = recipientByKey.get(field.recipientKey.trim());
        if (!recipientId) {
          throw new BadRequestException(`Template field recipient "${field.recipientKey}" does not exist.`);
        }

        await tx.signatureEnvelopeTemplateField.create({
          data: {
            templateId: created.id,
            recipientId,
            type: field.type,
            label: normalizeOptionalString(field.label) ?? null,
            placeholder: normalizeOptionalString(field.placeholder) ?? null,
            required: field.required ?? true,
            page: field.page,
            x: field.x,
            y: field.y,
            width: field.width,
            height: field.height
          }
        });
      }

      return tx.signatureEnvelopeTemplate.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          recipients: { orderBy: [{ routingOrder: "asc" }, { createdAt: "asc" }] },
          fields: { include: { recipient: true }, orderBy: [{ page: "asc" }, { createdAt: "asc" }] }
        }
      });
    });

    return this.mapTemplate(template);
  }

  async createTemplateFromEnvelope(
    envelopeId: string,
    input: { name: string },
    context: SignatureRequestContext
  ): Promise<ReturnType<SignatureRequestsService["mapTemplate"]>> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    return this.createTemplate({
      name: input.name,
      title: envelope.title ?? undefined,
      requesterEmail: envelope.requesterEmail,
      message: envelope.message ?? undefined,
      outputName: envelope.outputName,
      routing: envelope.routing,
      recipients: envelope.recipients.map((recipient) => ({
        key: recipient.id,
        name: recipient.name ?? undefined,
        email: recipient.email,
        role: recipient.role ?? undefined,
        routingOrder: recipient.routingOrder
      })),
      fields: envelope.fields.map((field) => ({
        recipientKey: field.recipientId,
        type: field.type,
        label: field.label ?? undefined,
        placeholder: field.placeholder ?? undefined,
        required: field.required,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height
      }))
    }, context);
  }

  async updateTemplate(
    templateId: string,
    input: SaveTemplateInput,
    context: SignatureRequestContext
  ): Promise<ReturnType<SignatureRequestsService["mapTemplate"]>> {
    await this.deleteTemplate(templateId, context);
    return this.createTemplate(input, context);
  }

  async deleteTemplate(templateId: string, context: SignatureRequestContext): Promise<{ ok: true }> {
    if (!context.ownerId) {
      throw new UnauthorizedException("Sign in to manage envelope templates.");
    }

    const deleted = await this.prisma.signatureEnvelopeTemplate.deleteMany({
      where: {
        id: templateId,
        ownerId: context.ownerId
      }
    });

    if (deleted.count === 0) {
      throw new NotFoundException("Envelope template not found.");
    }

    return { ok: true };
  }

  async createAuditCertificateForEnvelope(
    envelopeId: string,
    context: SignatureRequestContext
  ): Promise<{ fileName: string; buffer: Buffer }> {
    const envelope = await this.loadEnvelopeById(envelopeId, context);
    if (!envelope.finalFile) {
      throw new NotFoundException("Audit certificate is available after completion.");
    }

    return this.buildAuditCertificate(envelope);
  }

  async createAuditCertificateForToken(token: string): Promise<{ fileName: string; buffer: Buffer }> {
    const session = await this.loadRecipientSession(token);
    if (!this.isIdentityVerified(session)) {
      throw new UnauthorizedException("Verify your identity before downloading the audit certificate.");
    }
    if (!session.envelope.finalFile) {
      throw new NotFoundException("Audit certificate is available after completion.");
    }

    return this.buildAuditCertificate(session.envelope);
  }

  private async hashSecret(secret: string): Promise<string> {
    const salt = randomBytes(SECRET_SALT_BYTES).toString("base64url");
    const derived = (await scrypt(secret, salt, SECRET_HASH_BYTES)) as Buffer;
    return `${SECRET_HASH_PREFIX}$${salt}$${derived.toString("base64url")}`;
  }

  private async verifySecret(secret: string, storedHash: string): Promise<boolean> {
    const [prefix, salt, encodedHash] = storedHash.split("$");
    if (prefix !== SECRET_HASH_PREFIX || !salt || !encodedHash) {
      return false;
    }

    const expected = Buffer.from(encodedHash, "base64url");
    const actual = (await scrypt(secret, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  private assertCanVerify(session: RecipientSessionRecord): void {
    if (!isEnvelopeOpen(session.envelope.status)) {
      if (session.envelope.status === SignatureEnvelopeStatus.expired) {
        throw new GoneException("This signing workflow has expired.");
      }
      throw new BadRequestException("This signing workflow is no longer open.");
    }

    if (!this.isRecipientActiveTurn(session, session.envelope)) {
      throw new BadRequestException("This signer is not active yet.");
    }
  }

  private isIdentityVerified(
    recipient: Pick<RecipientSessionRecord, "otpVerifiedAt" | "passcodeHash" | "passcodeVerifiedAt">
  ): boolean {
    return Boolean(recipient.otpVerifiedAt) && (!recipient.passcodeHash || Boolean(recipient.passcodeVerifiedAt));
  }

  private mapVerificationState(
    recipient: Pick<RecipientSessionRecord, "otpExpiresAt" | "otpVerifiedAt" | "passcodeHash" | "passcodeVerifiedAt">
  ): {
    otpRequired: boolean;
    otpVerified: boolean;
    passcodeRequired: boolean;
    passcodeVerified: boolean;
    identityVerified: boolean;
    otpExpiresAt: Date | null;
  } {
    return {
      otpRequired: true,
      otpVerified: Boolean(recipient.otpVerifiedAt),
      passcodeRequired: Boolean(recipient.passcodeHash),
      passcodeVerified: !recipient.passcodeHash || Boolean(recipient.passcodeVerifiedAt),
      identityVerified: this.isIdentityVerified(recipient),
      otpExpiresAt: recipient.otpExpiresAt
    };
  }

  private async markViewedIfNeeded(
    session: RecipientSessionRecord,
    evidence: SignatureRequestEvidence = {}
  ): Promise<void> {
    if (
      session.status !== SignatureRecipientStatus.notified &&
      session.status !== SignatureRecipientStatus.waiting
    ) {
      return;
    }

    const viewedAt = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelopeRecipient.update({
        where: { id: session.id },
        data: {
          status: SignatureRecipientStatus.viewed,
          lastViewedAt: viewedAt
        }
      });

      await tx.signatureEnvelope.update({
        where: { id: session.envelopeId },
        data: {
          status:
            session.envelope.status === SignatureEnvelopeStatus.sent
              ? SignatureEnvelopeStatus.in_progress
              : session.envelope.status,
          startedAt: session.envelope.startedAt ?? viewedAt
        }
      });

      await this.logEvent(tx, {
        envelopeId: session.envelopeId,
        recipientId: session.id,
        type: SignatureEnvelopeEventType.viewed,
        actorEmail: session.email,
        description: `${session.name ?? session.email} opened the verified signing session.`,
        evidence
      });
    });
  }

  private async logVerificationFailure(
    session: RecipientSessionRecord,
    type: SignatureEnvelopeEventType,
    description: string,
    evidence: SignatureRequestEvidence
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.logEvent(tx, {
        envelopeId: session.envelopeId,
        recipientId: session.id,
        type,
        actorEmail: session.email,
        description,
        evidence
      });
    });
  }

  private async buildAuditCertificate(envelope: EnvelopeRecord): Promise<{ fileName: string; buffer: Buffer }> {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const lines: string[] = [];

    let finalHash: string | null = null;
    if (envelope.finalFile) {
      const finalBuffer = await this.storageService.readObjectBuffer(envelope.finalFile.objectKey);
      finalHash = hashBuffer(finalBuffer);
    }

    lines.push("iHatePDF Audit Certificate");
    lines.push(`Envelope ID: ${envelope.id}`);
    lines.push(`Document: ${envelope.sourceFile.fileName}`);
    lines.push(`Final output: ${envelope.outputName}`);
    lines.push(`Requester: ${envelope.requesterEmail}`);
    lines.push(`Status: ${envelope.status}`);
    lines.push(`Routing: ${envelope.routing}`);
    lines.push(`Created: ${envelope.createdAt.toISOString()}`);
    lines.push(`Completed: ${envelope.completedAt ? envelope.completedAt.toISOString() : "Not completed"}`);
    lines.push(`Final file ID: ${envelope.finalFileId ?? "Not available"}`);
    lines.push(`Final PDF SHA-256: ${finalHash ?? "Not available"}`);
    lines.push("");
    lines.push("Recipients");
    for (const recipient of envelope.recipients) {
      lines.push(
        `- ${recipient.name ?? recipient.email} <${recipient.email}> | ${recipient.role ?? "Signer"} | ${recipient.status} | OTP verified: ${recipient.otpVerifiedAt ? recipient.otpVerifiedAt.toISOString() : "no"} | passcode: ${recipient.passcodeHash ? (recipient.passcodeVerifiedAt ? "verified" : "required") : "not required"}`
      );
    }
    lines.push("");
    lines.push("Field Completion");
    for (const field of envelope.fields) {
      lines.push(
        `- ${field.label ?? field.type} | ${field.type} | page ${field.page} | signer ${field.recipient.email} | completed: ${field.value ? field.value.completedAt.toISOString() : "no"}`
      );
    }
    lines.push("");
    lines.push("Event Log");
    for (const event of envelope.events) {
      const evidence = [event.actorEmail, event.ipAddress, event.userAgent].filter(Boolean).join(" | ");
      lines.push(`- ${event.createdAt.toISOString()} | ${event.type} | ${event.description}${evidence ? ` | ${evidence}` : ""}`);
    }

    let page = pdf.addPage();
    let y = page.getHeight() - 48;
    const margin = 48;
    const lineHeight = 14;
    const maxWidth = page.getWidth() - margin * 2;

    const drawLine = (text: string, isTitle = false): void => {
      if (y < 48) {
        page = pdf.addPage();
        y = page.getHeight() - 48;
      }
      const font = isTitle ? bold : regular;
      const size = isTitle ? 16 : 9;
      const chunks = this.wrapText(text, font, size, maxWidth);
      for (const chunk of chunks) {
        if (y < 48) {
          page = pdf.addPage();
          y = page.getHeight() - 48;
        }
        page.drawText(chunk, {
          x: margin,
          y,
          size,
          font,
          color: isTitle ? rgb(0.08, 0.18, 0.3) : rgb(0.12, 0.12, 0.12)
        });
        y -= isTitle ? 22 : lineHeight;
      }
    };

    lines.forEach((line, index) => drawLine(line, index === 0));
    return {
      fileName: `${envelope.id}-audit-certificate.pdf`,
      buffer: Buffer.from(await pdf.save())
    };
  }

  private wrapText(text: string, font: { widthOfTextAtSize: (text: string, size: number) => number }, size: number, maxWidth: number): string[] {
    if (!text) {
      return [""];
    }

    const words = text.split(/\s+/);
    const lines: string[] = [];
    let current = "";

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
      }
      current = word;
    }

    if (current) {
      lines.push(current);
    }

    return lines.length > 0 ? lines : [text];
  }

  private mapTemplate(template: TemplateRecord): {
    id: string;
    name: string;
    title: string | null;
    requesterEmail: string | null;
    message: string | null;
    outputName: string;
    routing: SignatureEnvelopeRouting;
    createdAt: Date;
    updatedAt: Date;
    recipients: Array<{
      key: string;
      name: string | null;
      email: string | null;
      role: string | null;
      routingOrder: number;
    }>;
    fields: Array<{
      recipientKey: string;
      type: SignatureFieldType;
      label: string | null;
      placeholder: string | null;
      required: boolean;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
  } {
    return {
      id: template.id,
      name: template.name,
      title: template.title,
      requesterEmail: template.requesterEmail,
      message: template.message,
      outputName: template.outputName,
      routing: template.routing,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
      recipients: template.recipients.map((recipient) => ({
        key: recipient.key,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        routingOrder: recipient.routingOrder
      })),
      fields: template.fields.map((field) => ({
        recipientKey: field.recipient.key,
        type: field.type,
        label: field.label,
        placeholder: field.placeholder,
        required: field.required,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height
      }))
    };
  }

  private buildFinalizeFields(
    resolvedFields: Array<{
      field: EnvelopeRecord["fields"][number];
      valueJson: Prisma.JsonObject | null;
    }>
  ): FinalizeSignatureFieldPayload[] {
    return resolvedFields.flatMap(({ field, valueJson }) => {
      if (!valueJson) {
        if (field.required) {
          throw new BadRequestException(
            `Field "${field.label ?? field.type}" has no submitted value and cannot be finalized.`
          );
        }
        return [];
      }

      return [
        {
          fieldId: field.id,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          label: field.label ?? undefined,
          valueJson
        }
      ];
    });
  }

  private async enqueueFinalizationOrMarkFailure(
    payload: FinalizeSignatureQueuePayload
  ): Promise<void> {
    try {
      await this.queueService.enqueue("signature-request", payload);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to enqueue final signed PDF rendering.";

      await this.prisma.$transaction(async (tx) => {
        await tx.task.update({
          where: { id: payload.taskId },
          data: {
            status: "failed",
            errorMessage: message,
            progressMessage: message
          }
        });

        await tx.signatureEnvelope.updateMany({
          where: {
            id: payload.envelopeId,
            finalTaskId: payload.taskId,
            status: SignatureEnvelopeStatus.finalizing
          },
          data: {
            status: SignatureEnvelopeStatus.finalization_failed
          }
        });

        await this.logEvent(tx, {
          envelopeId: payload.envelopeId,
          type: SignatureEnvelopeEventType.finalization_failed,
          description: "Final signed PDF rendering failed before the worker could start.",
          metadata: {
            taskId: payload.taskId,
            error: message
          }
        });
      });

      throw error;
    }
  }

  private async loadEnvelopeById(
    id: string,
    context: SignatureRequestContext = {}
  ): Promise<EnvelopeRecord> {
    let envelope = await this.prisma.signatureEnvelope.findUnique({
      where: { id },
      include: envelopeInclude
    });

    if (!envelope) {
      throw new NotFoundException("Signing workflow not found.");
    }

    if (envelope.ownerId && envelope.ownerId !== context.ownerId) {
      throw new NotFoundException("Signing workflow not found.");
    }

    envelope = await this.expireEnvelopeIfNeeded(envelope);
    return envelope;
  }

  private async loadRecipientSession(token: string): Promise<RecipientSessionRecord> {
    let session = await this.prisma.signatureEnvelopeRecipient.findUnique({
      where: { token },
      include: {
        envelope: {
          include: envelopeInclude
        }
      }
    });

    if (!session) {
      throw new NotFoundException("Signing link not found.");
    }

    const envelope = await this.expireEnvelopeIfNeeded(session.envelope);
    session = await this.prisma.signatureEnvelopeRecipient.findUnique({
      where: { token },
      include: {
        envelope: {
          include: envelopeInclude
        }
      }
    });

    if (!session) {
      throw new NotFoundException("Signing link not found.");
    }

    if (envelope.status === SignatureEnvelopeStatus.expired) {
      session.envelope.status = SignatureEnvelopeStatus.expired;
    }

    return session;
  }

  private async expireEnvelopeIfNeeded(envelope: EnvelopeRecord): Promise<EnvelopeRecord> {
    if (!isEnvelopeOpen(envelope.status) || envelope.expiresAt.getTime() >= Date.now()) {
      return envelope;
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.signatureEnvelope.update({
        where: { id: envelope.id },
        data: {
          status: SignatureEnvelopeStatus.expired
        }
      });

      await this.logEvent(tx, {
        envelopeId: envelope.id,
        type: SignatureEnvelopeEventType.expired,
        actorEmail: envelope.requesterEmail,
        description: "Signing workflow expired before all recipients completed."
      });
    });

    await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.envelope.expired", {
      envelopeId: envelope.id,
      status: SignatureEnvelopeStatus.expired,
      expiredAt: new Date().toISOString()
    });

    return this.prisma.signatureEnvelope.findUniqueOrThrow({
      where: { id: envelope.id },
      include: envelopeInclude
    });
  }

  private assertEnvelopeManageable(envelope: EnvelopeRecord): void {
    if (!isEnvelopeOpen(envelope.status)) {
      throw new BadRequestException("This signing workflow can no longer be changed.");
    }
  }

  private getCurrentRoutingOrder(envelope: EnvelopeRecord): number | null {
    if (envelope.routing === SignatureEnvelopeRouting.parallel) {
      return null;
    }

    const openRecipients = envelope.recipients.filter((recipient) => isRecipientOpen(recipient.status));
    if (openRecipients.length === 0) {
      return null;
    }

    return Math.min(...openRecipients.map((recipient) => recipient.routingOrder));
  }

  private getCurrentTurnRecipients(envelope: EnvelopeRecord): EnvelopeRecord["recipients"] {
    if (envelope.routing === SignatureEnvelopeRouting.parallel) {
      return envelope.recipients.filter((recipient) => isRecipientOpen(recipient.status));
    }

    const currentOrder = this.getCurrentRoutingOrder(envelope);
    if (currentOrder === null) {
      return [];
    }

    return envelope.recipients.filter(
      (recipient) =>
        recipient.routingOrder === currentOrder && isRecipientOpen(recipient.status)
    );
  }

  private findNextOpenRoutingOrder(
    recipients: EnvelopeRecord["recipients"],
    currentOrder: number
  ): number | null {
    const orders = recipients
      .filter(
        (recipient) =>
          recipient.routingOrder > currentOrder &&
          recipient.status !== SignatureRecipientStatus.completed &&
          recipient.status !== SignatureRecipientStatus.revoked
      )
      .map((recipient) => recipient.routingOrder);

    if (orders.length === 0) {
      return null;
    }

    return Math.min(...orders);
  }

  private isRecipientActiveTurn(
    recipient: Pick<
      RecipientSessionRecord,
      "id" | "routingOrder" | "status"
    >,
    envelope: EnvelopeRecord
  ): boolean {
    if (!isRecipientOpen(recipient.status)) {
      return false;
    }

    if (envelope.routing === SignatureEnvelopeRouting.parallel) {
      return true;
    }

    const currentOrder = this.getCurrentRoutingOrder(envelope);
    return currentOrder !== null && recipient.routingOrder === currentOrder;
  }

  private normalizeSubmittedFieldValue(
    fieldType: SignatureFieldType,
    submitted?: SubmittedFieldValueInput
  ): Prisma.JsonObject | null {
    if (!submitted) {
      return null;
    }

    if (fieldType === SignatureFieldType.checkbox) {
      if (typeof submitted.checked !== "boolean") {
        return null;
      }
      return {
        checked: submitted.checked
      };
    }

    if (fieldType === SignatureFieldType.signature) {
      const signatureDataUrl = submitted.signatureDataUrl?.trim();
      if (!signatureDataUrl?.startsWith("data:image/")) {
        return null;
      }
      return {
        signatureDataUrl
      };
    }

    const textValue = submitted.textValue?.trim();
    if (!textValue) {
      return null;
    }

    return {
      text: textValue
    };
  }

  private async notifyRecipientsForCurrentTurn(
    envelope: EnvelopeRecord,
    isReminder: boolean,
    recipients = this.getCurrentTurnRecipients(envelope)
  ): Promise<void> {
    for (const recipient of recipients) {
      if (isReminder) {
        await this.mailService.sendSigningReminderMail({
          to: recipient.email,
          signerName: recipient.name ?? undefined,
          role: recipient.role ?? undefined,
          signingLink: this.buildSigningLink(recipient.token),
          title: envelope.title ?? envelope.sourceFile.fileName,
          requesterEmail: envelope.requesterEmail,
          message: envelope.message ?? undefined,
          expiresAt: envelope.expiresAt
        });
      } else {
        await this.mailService.sendSigningInviteMail({
          to: recipient.email,
          signerName: recipient.name ?? undefined,
          role: recipient.role ?? undefined,
          signingLink: this.buildSigningLink(recipient.token),
          title: envelope.title ?? envelope.sourceFile.fileName,
          requesterEmail: envelope.requesterEmail,
          message: envelope.message ?? undefined,
          expiresAt: envelope.expiresAt,
          routingOrder: recipient.routingOrder
        });

        await this.prisma.signatureEnvelopeEvent.create({
          data: {
            envelopeId: envelope.id,
            recipientId: recipient.id,
            type: SignatureEnvelopeEventType.notification_sent,
            actorEmail: envelope.requesterEmail,
            description: `Signing link sent to ${recipient.name ?? recipient.email}.`
          }
        });
        await this.webhooksService.dispatchForOwner(envelope.ownerId, "signing.notification_sent", {
          envelopeId: envelope.id,
          recipientId: recipient.id,
          recipientEmail: recipient.email,
          sentAt: new Date().toISOString()
        });
      }
    }
  }

  private buildSigningLink(token: string): string {
    return `${env.APP_BASE_URL}/sign-request/${token}`;
  }

  private mapEnvelopeCreationResponse(envelope: EnvelopeRecord): {
    id: string;
    status: SignatureEnvelopeStatus;
    routing: SignatureEnvelopeRouting;
    expiresAt: Date;
    manageUrl: string;
    signerLinks: Array<{
      recipientId: string;
      name: string | null;
      email: string;
      routingOrder: number;
      status: SignatureRecipientStatus;
      signingUrl: string;
    }>;
  } {
    return {
      id: envelope.id,
      status: envelope.status,
      routing: envelope.routing,
      expiresAt: envelope.expiresAt,
      manageUrl: `${env.APP_BASE_URL}/sign-pdf?envelope=${envelope.id}`,
      signerLinks: envelope.recipients.map((recipient) => ({
        recipientId: recipient.id,
        name: recipient.name,
        email: recipient.email,
        routingOrder: recipient.routingOrder,
        status: recipient.status,
        signingUrl: this.buildSigningLink(recipient.token)
      }))
    };
  }

  private mapEnvelopeView(envelope: EnvelopeRecord): {
    id: string;
    title: string | null;
    requesterEmail: string;
    status: SignatureEnvelopeStatus;
    routing: SignatureEnvelopeRouting;
    outputName: string;
    fileId: string;
    fileName: string;
    expiresAt: Date;
    createdAt: Date;
    completedAt: Date | null;
    revokedAt: Date | null;
    finalDownloadUrl: string | null;
    auditCertificateUrl: string | null;
    recipients: Array<{
      id: string;
      name: string | null;
      email: string;
      role: string | null;
      routingOrder: number;
      status: SignatureRecipientStatus;
      reminderCount: number;
      lastViewedAt: Date | null;
      completedAt: Date | null;
      signingUrl: string;
    }>;
    fields: Array<{
      id: string;
      recipientId: string;
      recipientName: string | null;
      type: SignatureFieldType;
      label: string | null;
      required: boolean;
      page: number;
      x: number;
      y: number;
      width: number;
      height: number;
      value: Prisma.JsonObject | null;
    }>;
    auditTrail: Array<{
      id: string;
      type: SignatureEnvelopeEventType;
      actorEmail: string | null;
      description: string;
      createdAt: Date;
      ipAddress: string | null;
      userAgent: string | null;
    }>;
  } {
    return {
      id: envelope.id,
      title: envelope.title,
      requesterEmail: envelope.requesterEmail,
      status: envelope.status,
      routing: envelope.routing,
      outputName: envelope.outputName,
      fileId: envelope.sourceFileId,
      fileName: envelope.sourceFile.fileName,
      expiresAt: envelope.expiresAt,
      createdAt: envelope.createdAt,
      completedAt: envelope.completedAt,
      revokedAt: envelope.revokedAt,
      finalDownloadUrl: envelope.finalFileId
        ? this.storageService.createDownloadUrl(envelope.finalFileId)
        : null,
      auditCertificateUrl: envelope.finalFileId
        ? `${env.API_PUBLIC_URL}/api/signature-requests/envelopes/${encodeURIComponent(envelope.id)}/audit-certificate`
        : null,
      recipients: envelope.recipients.map((recipient) => ({
        id: recipient.id,
        name: recipient.name,
        email: recipient.email,
        role: recipient.role,
        routingOrder: recipient.routingOrder,
        status: recipient.status,
        reminderCount: recipient.reminderCount,
        lastViewedAt: recipient.lastViewedAt,
        completedAt: recipient.completedAt,
        signingUrl: this.buildSigningLink(recipient.token)
      })),
      fields: envelope.fields.map((field) => ({
        id: field.id,
        recipientId: field.recipientId,
        recipientName: field.recipient.name,
        type: field.type,
        label: field.label,
        required: field.required,
        page: field.page,
        x: field.x,
        y: field.y,
        width: field.width,
        height: field.height,
        value: field.value ? (field.value.valueJson as Prisma.JsonObject) : null
      })),
      auditTrail: envelope.events.map((event) => ({
        id: event.id,
        type: event.type,
        actorEmail: event.actorEmail,
        description: event.description,
        createdAt: event.createdAt,
        ipAddress: event.ipAddress,
        userAgent: event.userAgent
      }))
    };
  }

  private async logEvent(
    tx: Prisma.TransactionClient,
    input: {
      envelopeId: string;
      recipientId?: string;
      type: SignatureEnvelopeEventType;
      actorEmail?: string;
      description: string;
      metadata?: EventMetadata;
      evidence?: SignatureRequestEvidence;
    }
  ): Promise<void> {
    await tx.signatureEnvelopeEvent.create({
      data: {
        envelopeId: input.envelopeId,
        recipientId: input.recipientId,
        type: input.type,
        actorEmail: input.actorEmail,
        ipAddress: input.evidence?.ipAddress,
        userAgent: input.evidence?.userAgent,
        description: input.description,
        metadata: input.metadata
      }
    });
  }
}
