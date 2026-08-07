-- Partner-provisioned installs.
--
-- One row per customer that a partner product (today: the help centre)
-- has provisioned a chat widget for. This is the idempotency anchor for
-- POST /api/v1/partner/installs — a retried call finds the existing row
-- on (provider, externalId) and returns the same account instead of
-- minting a second workspace for the same person.
--
-- Also the resumable state machine: provisioning creates a User, a
-- Workspace, a native Location, an Agent and a ChatWidget, and any of
-- those can fail midway. The status column plus the nullable id columns
-- let a retry pick up where the last attempt stopped.
--
-- Safe to run before the deploy. Safe to re-run.

CREATE TABLE IF NOT EXISTS "PartnerInstall" (
  "id"            TEXT NOT NULL,
  "provider"      TEXT NOT NULL,
  "externalId"    TEXT NOT NULL,
  "externalEmail" TEXT NOT NULL,
  "businessName"  TEXT NOT NULL,
  "userId"        TEXT,
  "workspaceId"   TEXT,
  "agentId"       TEXT,
  "widgetId"      TEXT,
  "status"        TEXT NOT NULL DEFAULT 'provisioning',
  "failureReason" TEXT,
  "metadata"      JSONB,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PartnerInstall_pkey" PRIMARY KEY ("id")
);

-- The idempotency key. Two concurrent provisions of the same partner
-- account race on this constraint; the loser catches P2002 and adopts
-- the winner's row.
CREATE UNIQUE INDEX IF NOT EXISTS "PartnerInstall_provider_externalId_key"
  ON "PartnerInstall" ("provider", "externalId");

CREATE INDEX IF NOT EXISTS "PartnerInstall_workspaceId_idx"
  ON "PartnerInstall" ("workspaceId");

-- Support lookups ("which install does this customer belong to?").
CREATE INDEX IF NOT EXISTS "PartnerInstall_externalEmail_idx"
  ON "PartnerInstall" ("externalEmail");

-- No foreign keys on userId / workspaceId / agentId / widgetId. They are
-- deliberately soft pointers: an install record is an audit trail of what
-- we provisioned and must survive the customer deleting their agent or
-- widget, so support can still see what happened.
