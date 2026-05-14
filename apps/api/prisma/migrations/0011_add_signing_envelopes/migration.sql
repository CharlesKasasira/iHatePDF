CREATE TYPE "SignatureEnvelopeStatus" AS ENUM ('sent', 'in_progress', 'finalizing', 'completed', 'expired', 'revoked');
CREATE TYPE "SignatureEnvelopeRouting" AS ENUM ('sequential', 'parallel');
CREATE TYPE "SignatureRecipientStatus" AS ENUM ('waiting', 'notified', 'viewed', 'completed', 'revoked');
CREATE TYPE "SignatureFieldType" AS ENUM ('signature', 'initials', 'name', 'date', 'checkbox', 'text');
CREATE TYPE "SignatureEnvelopeEventType" AS ENUM ('created', 'notification_sent', 'viewed', 'reminded', 'completed', 'reassigned', 'revoked', 'expired', 'finalized');

CREATE TABLE "SignatureEnvelope" (
  "id" TEXT NOT NULL,
  "title" TEXT,
  "requesterEmail" TEXT NOT NULL,
  "message" TEXT,
  "outputName" TEXT NOT NULL,
  "status" "SignatureEnvelopeStatus" NOT NULL DEFAULT 'sent',
  "routing" "SignatureEnvelopeRouting" NOT NULL DEFAULT 'sequential',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "immutableAt" TIMESTAMP(3) NOT NULL,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "sourceFileId" TEXT NOT NULL,
  "finalFileId" TEXT,
  "finalTaskId" TEXT,
  CONSTRAINT "SignatureEnvelope_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeRecipient" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT NOT NULL,
  "role" TEXT,
  "routingOrder" INTEGER NOT NULL,
  "status" "SignatureRecipientStatus" NOT NULL DEFAULT 'waiting',
  "lastViewedAt" TIMESTAMP(3),
  "notifiedAt" TIMESTAMP(3),
  "remindedAt" TIMESTAMP(3),
  "reminderCount" INTEGER NOT NULL DEFAULT 0,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "envelopeId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeField" (
  "id" TEXT NOT NULL,
  "type" "SignatureFieldType" NOT NULL,
  "label" TEXT,
  "placeholder" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "page" INTEGER NOT NULL,
  "x" DOUBLE PRECISION NOT NULL,
  "y" DOUBLE PRECISION NOT NULL,
  "width" DOUBLE PRECISION NOT NULL,
  "height" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeField_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeFieldValue" (
  "id" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "envelopeId" TEXT NOT NULL,
  "fieldId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeFieldValue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeEvent" (
  "id" TEXT NOT NULL,
  "type" "SignatureEnvelopeEventType" NOT NULL,
  "actorEmail" TEXT,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "envelopeId" TEXT NOT NULL,
  "recipientId" TEXT,
  CONSTRAINT "SignatureEnvelopeEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureEnvelopeRecipient_token_key" ON "SignatureEnvelopeRecipient"("token");
CREATE UNIQUE INDEX "SignatureEnvelopeFieldValue_fieldId_key" ON "SignatureEnvelopeFieldValue"("fieldId");

CREATE INDEX "SignatureEnvelope_status_idx" ON "SignatureEnvelope"("status");
CREATE INDEX "SignatureEnvelope_expiresAt_idx" ON "SignatureEnvelope"("expiresAt");
CREATE INDEX "SignatureEnvelopeRecipient_envelopeId_routingOrder_idx" ON "SignatureEnvelopeRecipient"("envelopeId", "routingOrder");
CREATE INDEX "SignatureEnvelopeRecipient_envelopeId_status_idx" ON "SignatureEnvelopeRecipient"("envelopeId", "status");
CREATE INDEX "SignatureEnvelopeField_envelopeId_page_idx" ON "SignatureEnvelopeField"("envelopeId", "page");
CREATE INDEX "SignatureEnvelopeField_recipientId_idx" ON "SignatureEnvelopeField"("recipientId");
CREATE INDEX "SignatureEnvelopeFieldValue_envelopeId_idx" ON "SignatureEnvelopeFieldValue"("envelopeId");
CREATE INDEX "SignatureEnvelopeFieldValue_recipientId_idx" ON "SignatureEnvelopeFieldValue"("recipientId");
CREATE INDEX "SignatureEnvelopeEvent_envelopeId_createdAt_idx" ON "SignatureEnvelopeEvent"("envelopeId", "createdAt");
CREATE INDEX "SignatureEnvelopeEvent_recipientId_idx" ON "SignatureEnvelopeEvent"("recipientId");

ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_sourceFileId_fkey"
  FOREIGN KEY ("sourceFileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelope"
  ADD CONSTRAINT "SignatureEnvelope_finalFileId_fkey"
  FOREIGN KEY ("finalFileId") REFERENCES "FileObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeRecipient"
  ADD CONSTRAINT "SignatureEnvelopeRecipient_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeField"
  ADD CONSTRAINT "SignatureEnvelopeField_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeField"
  ADD CONSTRAINT "SignatureEnvelopeField_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "SignatureEnvelopeRecipient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeFieldValue"
  ADD CONSTRAINT "SignatureEnvelopeFieldValue_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeFieldValue"
  ADD CONSTRAINT "SignatureEnvelopeFieldValue_fieldId_fkey"
  FOREIGN KEY ("fieldId") REFERENCES "SignatureEnvelopeField"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeFieldValue"
  ADD CONSTRAINT "SignatureEnvelopeFieldValue_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "SignatureEnvelopeRecipient"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeEvent"
  ADD CONSTRAINT "SignatureEnvelopeEvent_envelopeId_fkey"
  FOREIGN KEY ("envelopeId") REFERENCES "SignatureEnvelope"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeEvent"
  ADD CONSTRAINT "SignatureEnvelopeEvent_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "SignatureEnvelopeRecipient"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
