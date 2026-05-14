import {
  BadRequestException,
  GoneException,
  Injectable,
  NotFoundException
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
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
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

type EventMetadata = Prisma.InputJsonValue | undefined;

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

function asJsonObject(value: Prisma.InputJsonValue): Prisma.JsonObject {
  return value as Prisma.JsonObject;
}

@Injectable()
export class SignatureRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly mailService: MailService,
    private readonly storageService: StorageService
  ) {}

  async createRequest(input: CreateSignatureEnvelopeInput): Promise<{
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

    if (file.mimeType !== "application/pdf") {
      throw new BadRequestException("Signature workflows require a PDF input file.");
    }

    const recipients = input.recipients.map((recipient) => ({
      key: recipient.key.trim(),
      name: normalizeOptionalString(recipient.name) ?? null,
      email: recipient.email.trim().toLowerCase(),
      role: normalizeOptionalString(recipient.role) ?? null,
      routingOrder: recipient.routingOrder
    }));

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
          sourceFileId: file.id
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
        }
      });

      return tx.signatureEnvelope.findUniqueOrThrow({
        where: { id: createdEnvelope.id },
        include: envelopeInclude
      });
    });

    await this.notifyRecipientsForCurrentTurn(envelope, false);

    return this.mapEnvelopeCreationResponse(envelope);
  }

  async getEnvelope(id: string): Promise<ReturnType<SignatureRequestsService["mapEnvelopeView"]>> {
    const envelope = await this.loadEnvelopeById(id);
    return this.mapEnvelopeView(envelope);
  }

  async retryFinalization(envelopeId: string): Promise<{ envelopeId: string; taskId: string }> {
    const envelope = await this.loadEnvelopeById(envelopeId);
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
        }
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

  async getByToken(token: string): Promise<{
    envelopeId: string;
    title: string | null;
    requesterEmail: string;
    status: SignatureEnvelopeStatus;
    routing: SignatureEnvelopeRouting;
    fileId: string;
    fileName: string;
    message: string | null;
    expiresAt: Date;
    currentOrder: number | null;
    canSubmit: boolean;
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
    }>;
    finalDownloadUrl: string | null;
  }> {
    const session = await this.loadRecipientSession(token);
    const isActiveTurn = this.isRecipientActiveTurn(session, session.envelope);
    const canSubmit =
      isActiveTurn &&
      isEnvelopeOpen(session.envelope.status) &&
      session.status !== SignatureRecipientStatus.completed;

    if (
      canSubmit &&
      (session.status === SignatureRecipientStatus.notified ||
        session.status === SignatureRecipientStatus.waiting)
    ) {
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
          description: `${session.name ?? session.email} opened the signing link.`
        });
      });
    }

    const refreshed = await this.loadRecipientSession(token);

    return {
      envelopeId: refreshed.envelope.id,
      title: refreshed.envelope.title,
      requesterEmail: refreshed.envelope.requesterEmail,
      status: refreshed.envelope.status,
      routing: refreshed.envelope.routing,
      fileId: refreshed.envelope.sourceFileId,
      fileName: refreshed.envelope.sourceFile.fileName,
      message: refreshed.envelope.message,
      expiresAt: refreshed.envelope.expiresAt,
      currentOrder: this.getCurrentRoutingOrder(refreshed.envelope),
      canSubmit:
        this.isRecipientActiveTurn(refreshed, refreshed.envelope) &&
        isEnvelopeOpen(refreshed.envelope.status) &&
        refreshed.status !== SignatureRecipientStatus.completed,
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
      fields: refreshed.envelope.fields.map((field) => ({
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
      })),
      auditTrail: refreshed.envelope.events.map((event) => ({
        id: event.id,
        type: event.type,
        actorEmail: event.actorEmail,
        description: event.description,
        createdAt: event.createdAt
      })),
      finalDownloadUrl: refreshed.envelope.finalFileId
        ? this.storageService.createDownloadUrl(refreshed.envelope.finalFileId)
        : null
    };
  }

  async completeByToken(
    token: string,
    payload: CompleteSignatureRequestInput
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
        }
      });

      if (isFinalSigner) {
        const finalizeFields = this.buildFinalizeFields(allFieldsWithCurrentValues);

        const task = await tx.task.create({
          data: {
            type: TaskType.signature_request,
            status: "queued",
            inputFileId: session.envelope.sourceFileId,
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
    return {
      envelopeId: refreshedEnvelope.id,
      status: refreshedEnvelope.status,
      taskId: finalTaskId
    };
  }

  async remindRecipient(
    envelopeId: string,
    recipientId: string
  ): Promise<{ ok: true }> {
    const envelope = await this.loadEnvelopeById(envelopeId);
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
        description: `Reminder sent to ${recipient.name ?? recipient.email}.`
      });
    });

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

    return { ok: true };
  }

  async reassignRecipient(
    envelopeId: string,
    recipientId: string,
    input: ReassignRecipientInput
  ): Promise<{ ok: true; signingUrl: string }> {
    const envelope = await this.loadEnvelopeById(envelopeId);
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
        }
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

    return {
      ok: true,
      signingUrl: this.buildSigningLink(nextToken)
    };
  }

  async revokeEnvelope(envelopeId: string): Promise<{ ok: true }> {
    const envelope = await this.loadEnvelopeById(envelopeId);
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
        description: "Signing workflow revoked by the sender."
      });
    });

    return { ok: true };
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

  private async loadEnvelopeById(id: string): Promise<EnvelopeRecord> {
    let envelope = await this.prisma.signatureEnvelope.findUnique({
      where: { id },
      include: envelopeInclude
    });

    if (!envelope) {
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
    await Promise.all(
      recipients.map((recipient) =>
        isReminder
          ? this.mailService.sendSigningReminderMail({
              to: recipient.email,
              signerName: recipient.name ?? undefined,
              role: recipient.role ?? undefined,
              signingLink: this.buildSigningLink(recipient.token),
              title: envelope.title ?? envelope.sourceFile.fileName,
              requesterEmail: envelope.requesterEmail,
              message: envelope.message ?? undefined,
              expiresAt: envelope.expiresAt
            })
          : this.mailService.sendSigningInviteMail({
              to: recipient.email,
              signerName: recipient.name ?? undefined,
              role: recipient.role ?? undefined,
              signingLink: this.buildSigningLink(recipient.token),
              title: envelope.title ?? envelope.sourceFile.fileName,
              requesterEmail: envelope.requesterEmail,
              message: envelope.message ?? undefined,
              expiresAt: envelope.expiresAt,
              routingOrder: recipient.routingOrder
            })
      )
    );

    if (!isReminder) {
      for (const recipient of recipients) {
        await this.prisma.signatureEnvelopeEvent.create({
          data: {
            envelopeId: envelope.id,
            recipientId: recipient.id,
            type: SignatureEnvelopeEventType.notification_sent,
            actorEmail: envelope.requesterEmail,
            description: `Signing link sent to ${recipient.name ?? recipient.email}.`
          }
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
        createdAt: event.createdAt
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
    }
  ): Promise<void> {
    await tx.signatureEnvelopeEvent.create({
      data: {
        envelopeId: input.envelopeId,
        recipientId: input.recipientId,
        type: input.type,
        actorEmail: input.actorEmail,
        description: input.description,
        metadata: input.metadata
      }
    });
  }
}
