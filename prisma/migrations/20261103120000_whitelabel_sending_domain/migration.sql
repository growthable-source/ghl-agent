-- Idempotent on purpose: test (preview) builds may already have added
-- this via lib/whitelabel/ensure-test-schema.ts, which runs the same
-- statements. Every statement is a no-op when its object exists.

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkspaceSendingDomain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "resendDomainId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dnsRecords" JSONB NOT NULL DEFAULT '[]',
    "lastError" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceSendingDomain_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSendingDomain_workspaceId_key" ON "WorkspaceSendingDomain"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceSendingDomain_domain_key" ON "WorkspaceSendingDomain"("domain");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WorkspaceSendingDomain_status_idx" ON "WorkspaceSendingDomain"("status");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceSendingDomain_workspaceId_fkey') THEN
    ALTER TABLE "WorkspaceSendingDomain" ADD CONSTRAINT "WorkspaceSendingDomain_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
