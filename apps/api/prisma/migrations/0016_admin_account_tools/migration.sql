ALTER TABLE "User"
  ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "suspendedAt" TIMESTAMP(3),
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockReason" TEXT;

ALTER TABLE "Task"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastRetriedAt" TIMESTAMP(3);

ALTER TABLE "ApiKey"
  ADD COLUMN "rateLimitedAt" TIMESTAMP(3),
  ADD COLUMN "rateLimitReason" TEXT;

CREATE TABLE "ApiUsageEvent" (
  "id" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "statusCode" INTEGER,
  "taskId" TEXT,
  "fileId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ownerId" TEXT NOT NULL,
  "apiKeyId" TEXT,
  CONSTRAINT "ApiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "UserSecurityEventType" AS ENUM (
  'login_success',
  'login_failed',
  'account_auto_locked',
  'account_locked',
  'account_unlocked',
  'sessions_revoked'
);

CREATE TABLE "UserSecurityEvent" (
  "id" TEXT NOT NULL,
  "type" "UserSecurityEventType" NOT NULL,
  "email" TEXT,
  "actorEmail" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "description" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userId" TEXT,
  CONSTRAINT "UserSecurityEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ApiUsageEvent_ownerId_createdAt_idx" ON "ApiUsageEvent"("ownerId", "createdAt");
CREATE INDEX "ApiUsageEvent_apiKeyId_createdAt_idx" ON "ApiUsageEvent"("apiKeyId", "createdAt");
CREATE INDEX "ApiUsageEvent_route_createdAt_idx" ON "ApiUsageEvent"("route", "createdAt");
CREATE INDEX "UserSecurityEvent_userId_createdAt_idx" ON "UserSecurityEvent"("userId", "createdAt");
CREATE INDEX "UserSecurityEvent_email_createdAt_idx" ON "UserSecurityEvent"("email", "createdAt");
CREATE INDEX "UserSecurityEvent_type_createdAt_idx" ON "UserSecurityEvent"("type", "createdAt");

ALTER TABLE "ApiUsageEvent"
  ADD CONSTRAINT "ApiUsageEvent_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiUsageEvent"
  ADD CONSTRAINT "ApiUsageEvent_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "UserSecurityEvent"
  ADD CONSTRAINT "UserSecurityEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
