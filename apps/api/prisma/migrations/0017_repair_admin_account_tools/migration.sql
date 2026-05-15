ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "isAdmin" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lockReason" TEXT;

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastRetriedAt" TIMESTAMP(3);

ALTER TABLE "ApiKey"
  ADD COLUMN IF NOT EXISTS "rateLimitedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rateLimitReason" TEXT;

DO $$
BEGIN
  CREATE TYPE "UserSecurityEventType" AS ENUM (
    'login_success',
    'login_failed',
    'account_auto_locked',
    'account_locked',
    'account_unlocked',
    'sessions_revoked'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'login_success';
ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'login_failed';
ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'account_auto_locked';
ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'account_locked';
ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'account_unlocked';
ALTER TYPE "UserSecurityEventType" ADD VALUE IF NOT EXISTS 'sessions_revoked';

CREATE TABLE IF NOT EXISTS "ApiUsageEvent" (
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

ALTER TABLE "ApiUsageEvent"
  ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "method" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "route" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "statusCode" INTEGER,
  ADD COLUMN IF NOT EXISTS "taskId" TEXT,
  ADD COLUMN IF NOT EXISTS "fileId" TEXT,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "ownerId" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "apiKeyId" TEXT;

CREATE TABLE IF NOT EXISTS "UserSecurityEvent" (
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

ALTER TABLE "UserSecurityEvent"
  ADD COLUMN IF NOT EXISTS "id" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "type" "UserSecurityEventType" NOT NULL,
  ADD COLUMN IF NOT EXISTS "email" TEXT,
  ADD COLUMN IF NOT EXISTS "actorEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT NOT NULL,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "ApiUsageEvent_ownerId_createdAt_idx" ON "ApiUsageEvent"("ownerId", "createdAt");
CREATE INDEX IF NOT EXISTS "ApiUsageEvent_apiKeyId_createdAt_idx" ON "ApiUsageEvent"("apiKeyId", "createdAt");
CREATE INDEX IF NOT EXISTS "ApiUsageEvent_route_createdAt_idx" ON "ApiUsageEvent"("route", "createdAt");
CREATE INDEX IF NOT EXISTS "UserSecurityEvent_userId_createdAt_idx" ON "UserSecurityEvent"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "UserSecurityEvent_email_createdAt_idx" ON "UserSecurityEvent"("email", "createdAt");
CREATE INDEX IF NOT EXISTS "UserSecurityEvent_type_createdAt_idx" ON "UserSecurityEvent"("type", "createdAt");

DO $$
BEGIN
  ALTER TABLE "ApiUsageEvent"
    ADD CONSTRAINT "ApiUsageEvent_ownerId_fkey"
    FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "ApiUsageEvent"
    ADD CONSTRAINT "ApiUsageEvent_apiKeyId_fkey"
    FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "UserSecurityEvent"
    ADD CONSTRAINT "UserSecurityEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
