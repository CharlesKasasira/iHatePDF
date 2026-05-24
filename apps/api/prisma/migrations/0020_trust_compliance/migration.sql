CREATE TABLE "FileDeletionReceipt" (
  "id" TEXT NOT NULL,
  "fileId" TEXT,
  "objectKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "ownerId" TEXT,
  "ownerEmail" TEXT,
  "reason" TEXT NOT NULL,
  "storageDeleted" BOOLEAN NOT NULL DEFAULT false,
  "storageError" TEXT,
  "fileCreatedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FileDeletionReceipt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileDeletionReceipt_deletedAt_idx" ON "FileDeletionReceipt"("deletedAt");
CREATE INDEX "FileDeletionReceipt_ownerId_deletedAt_idx" ON "FileDeletionReceipt"("ownerId", "deletedAt");
