ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'otp_requested';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'otp_verified';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'otp_failed';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'passcode_verified';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'passcode_failed';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'completion_email_sent';
ALTER TYPE "SignatureEnvelopeEventType" ADD VALUE IF NOT EXISTS 'completion_email_failed';

ALTER TABLE "SignatureEnvelopeRecipient"
  ADD COLUMN "otpHash" TEXT,
  ADD COLUMN "otpExpiresAt" TIMESTAMP(3),
  ADD COLUMN "otpVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "otpAttemptCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "passcodeHash" TEXT,
  ADD COLUMN "passcodeVerifiedAt" TIMESTAMP(3);

ALTER TABLE "SignatureEnvelopeEvent"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT;

CREATE TABLE "SignatureEnvelopeTemplate" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "title" TEXT,
  "requesterEmail" TEXT,
  "message" TEXT,
  "outputName" TEXT NOT NULL,
  "routing" "SignatureEnvelopeRouting" NOT NULL DEFAULT 'sequential',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "ownerId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeTemplateRecipient" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT,
  "email" TEXT,
  "role" TEXT,
  "routingOrder" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "templateId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeTemplateRecipient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureEnvelopeTemplateField" (
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
  "templateId" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  CONSTRAINT "SignatureEnvelopeTemplateField_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SignatureEnvelopeTemplate_ownerId_createdAt_idx" ON "SignatureEnvelopeTemplate"("ownerId", "createdAt");
CREATE UNIQUE INDEX "SignatureEnvelopeTemplateRecipient_templateId_key_key" ON "SignatureEnvelopeTemplateRecipient"("templateId", "key");
CREATE INDEX "SignatureEnvelopeTemplateRecipient_templateId_routingOrder_idx" ON "SignatureEnvelopeTemplateRecipient"("templateId", "routingOrder");
CREATE INDEX "SignatureEnvelopeTemplateField_templateId_page_idx" ON "SignatureEnvelopeTemplateField"("templateId", "page");
CREATE INDEX "SignatureEnvelopeTemplateField_recipientId_idx" ON "SignatureEnvelopeTemplateField"("recipientId");

ALTER TABLE "SignatureEnvelopeTemplate"
  ADD CONSTRAINT "SignatureEnvelopeTemplate_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeTemplateRecipient"
  ADD CONSTRAINT "SignatureEnvelopeTemplateRecipient_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "SignatureEnvelopeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeTemplateField"
  ADD CONSTRAINT "SignatureEnvelopeTemplateField_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "SignatureEnvelopeTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "SignatureEnvelopeTemplateField"
  ADD CONSTRAINT "SignatureEnvelopeTemplateField_recipientId_fkey"
  FOREIGN KEY ("recipientId") REFERENCES "SignatureEnvelopeTemplateRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
