-- Create enums
CREATE TYPE "TaskType" AS ENUM ('merge', 'split', 'sign', 'signature_request');
CREATE TYPE "TaskStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');
CREATE TYPE "SignatureRequestStatus" AS ENUM ('pending', 'completed', 'expired', 'cancelled');

-- Create tables
CREATE TABLE "FileObject" (
  "id" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Task" (
  "id" TEXT NOT NULL,
  "type" "TaskType" NOT NULL,
  "status" "TaskStatus" NOT NULL DEFAULT 'queued',
  "payload" JSONB NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "inputFileId" TEXT,
  "outputFileId" TEXT,
  CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SignatureRequest" (
  "id" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "status" "SignatureRequestStatus" NOT NULL DEFAULT 'pending',
  "requesterEmail" TEXT NOT NULL,
  "signerEmail" TEXT NOT NULL,
  "message" TEXT,
  "payload" JSONB,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "signedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fileId" TEXT NOT NULL,
  "signedTaskId" TEXT,
  CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "FileObject_objectKey_key" ON "FileObject"("objectKey");
CREATE UNIQUE INDEX "SignatureRequest_token_key" ON "SignatureRequest"("token");

-- Add foreign keys
ALTER TABLE "Task"
  ADD CONSTRAINT "Task_inputFileId_fkey"
  FOREIGN KEY ("inputFileId") REFERENCES "FileObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Task"
  ADD CONSTRAINT "Task_outputFileId_fkey"
  FOREIGN KEY ("outputFileId") REFERENCES "FileObject"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SignatureRequest"
  ADD CONSTRAINT "SignatureRequest_fileId_fkey"
  FOREIGN KEY ("fileId") REFERENCES "FileObject"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
