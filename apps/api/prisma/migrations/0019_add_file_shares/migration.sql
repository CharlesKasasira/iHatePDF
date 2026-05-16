CREATE TABLE "FileShare" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "recipientEmail" TEXT,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastAccessedAt" TIMESTAMP(3),
    "downloadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fileId" TEXT NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "FileShare_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FileShare_token_key" ON "FileShare"("token");
CREATE INDEX "FileShare_fileId_createdAt_idx" ON "FileShare"("fileId", "createdAt");
CREATE INDEX "FileShare_createdById_createdAt_idx" ON "FileShare"("createdById", "createdAt");
CREATE INDEX "FileShare_expiresAt_idx" ON "FileShare"("expiresAt");

ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FileShare" ADD CONSTRAINT "FileShare_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
