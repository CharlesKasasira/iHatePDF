CREATE TABLE "FileShareComment" (
  "id" TEXT NOT NULL,
  "authorName" TEXT,
  "authorEmail" TEXT,
  "pageNumber" INTEGER NOT NULL,
  "body" TEXT NOT NULL,
  "x" DOUBLE PRECISION,
  "y" DOUBLE PRECISION,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "shareId" TEXT NOT NULL,

  CONSTRAINT "FileShareComment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FileShareComment_shareId_createdAt_idx" ON "FileShareComment"("shareId", "createdAt");
CREATE INDEX "FileShareComment_shareId_pageNumber_idx" ON "FileShareComment"("shareId", "pageNumber");

ALTER TABLE "FileShareComment"
  ADD CONSTRAINT "FileShareComment_shareId_fkey"
  FOREIGN KEY ("shareId") REFERENCES "FileShare"("id") ON DELETE CASCADE ON UPDATE CASCADE;
