-- Lifecycle bookkeeping for WorkspaceDomain (follow-up to
-- 20261011120000_workspace_whitelabel_domain, which is not edited).
ALTER TABLE "WorkspaceDomain"
  ADD COLUMN "addedByUs" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "pendingSince" TIMESTAMP(3),
  ADD COLUMN "failedChecks" INTEGER NOT NULL DEFAULT 0;

-- Existing non-active rows start their pending clock at creation.
UPDATE "WorkspaceDomain" SET "pendingSince" = "createdAt" WHERE "status" <> 'active';
