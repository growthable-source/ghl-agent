-- Per-workspace white-label domain for Co-Pilot links + widget.
-- Admin "unlock" flag on Workspace; one WorkspaceDomain row per workspace.

ALTER TABLE "Workspace"
  ADD COLUMN "whitelabelUnlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "whitelabelUnlockedAt" TIMESTAMP(3),
  ADD COLUMN "whitelabelUnlockedBy" TEXT;

CREATE TABLE "WorkspaceDomain" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "hostname" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dnsRecords" JSONB NOT NULL DEFAULT '[]',
  "lastError" TEXT,
  "lastCheckedAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WorkspaceDomain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkspaceDomain_workspaceId_key" ON "WorkspaceDomain"("workspaceId");
CREATE UNIQUE INDEX "WorkspaceDomain_hostname_key" ON "WorkspaceDomain"("hostname");
CREATE INDEX "WorkspaceDomain_status_idx" ON "WorkspaceDomain"("status");

ALTER TABLE "WorkspaceDomain"
  ADD CONSTRAINT "WorkspaceDomain_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
