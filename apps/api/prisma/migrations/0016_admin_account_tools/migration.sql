ALTER TABLE "User"
  ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Task"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastRetriedAt" TIMESTAMP(3);

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

CREATE INDEX "ApiUsageEvent_ownerId_createdAt_idx" ON "ApiUsageEvent"("ownerId", "createdAt");
CREATE INDEX "ApiUsageEvent_apiKeyId_createdAt_idx" ON "ApiUsageEvent"("apiKeyId", "createdAt");
CREATE INDEX "ApiUsageEvent_route_createdAt_idx" ON "ApiUsageEvent"("route", "createdAt");

ALTER TABLE "ApiUsageEvent"
  ADD CONSTRAINT "ApiUsageEvent_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ApiUsageEvent"
  ADD CONSTRAINT "ApiUsageEvent_apiKeyId_fkey"
  FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE SET NULL ON UPDATE CASCADE;
