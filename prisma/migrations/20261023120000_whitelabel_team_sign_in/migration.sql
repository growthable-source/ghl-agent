-- Idempotent on purpose: test (preview) builds may already have added
-- these via lib/whitelabel/ensure-test-schema.ts, which runs the same
-- statements. Every statement is a no-op when its object exists.

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelLogoUrl" TEXT,
ADD COLUMN IF NOT EXISTS "whitelabelAccentColor" TEXT,
ADD COLUMN IF NOT EXISTS "whitelabelLoginHeading" TEXT,
ADD COLUMN IF NOT EXISTS "whitelabelLoginMessage" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkspaceLoginCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceLoginCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkspaceLoginCode_workspaceId_email_createdAt_idx" ON "WorkspaceLoginCode"("workspaceId", "email", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkspaceLoginCode_ip_createdAt_idx" ON "WorkspaceLoginCode"("ip", "createdAt");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceLoginCode_workspaceId_fkey') THEN
    ALTER TABLE "WorkspaceLoginCode" ADD CONSTRAINT "WorkspaceLoginCode_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
