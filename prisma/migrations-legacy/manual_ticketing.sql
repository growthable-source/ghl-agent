-- ============================================================================
-- TICKETING — email-driven case management for the native CRM workspaces.
-- ============================================================================
-- Three tables: Ticket, TicketMessage, TicketingSettings.
--   - Ticket: the case row. workspace-scoped sequential ticketNumber for
--     display (#1042). Optional 1:1 link back to a WidgetConversation
--     when promoted from chat.
--   - TicketMessage: append-only thread (inbound / outbound / internal_note).
--     Holds RFC 5322 Message-ID + In-Reply-To so a future inbound-email
--     webhook can thread replies onto the right ticket.
--   - TicketingSettings: per-workspace toggle + auto-close knobs + from-email
--     identity for outbound.
--
-- Plan-gated to the Scale tier at the application layer (lib/plans.ts) —
-- the schema doesn't enforce that.
--
-- Idempotent: every statement uses IF NOT EXISTS / IF EXISTS so re-running
-- on a DB that already has some of the tables is safe.
-- ============================================================================

-- ─── Ticket ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Ticket" (
  "id"             TEXT PRIMARY KEY,
  "workspaceId"    TEXT NOT NULL REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "ticketNumber"   INTEGER NOT NULL,
  "conversationId" TEXT UNIQUE REFERENCES "WidgetConversation"("id") ON DELETE SET NULL,

  "contactEmail"   TEXT NOT NULL,
  "contactName"    TEXT,
  "contactPhone"   TEXT,
  "crmContactId"   TEXT,

  "subject"        VARCHAR(255) NOT NULL,
  "priority"       TEXT NOT NULL DEFAULT 'normal',
  "status"         TEXT NOT NULL DEFAULT 'open',

  "assignedUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "assignedAt"     TIMESTAMPTZ,

  "lastActivityAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "lastInboundAt"  TIMESTAMPTZ,
  "lastOutboundAt" TIMESTAMPTZ,
  "closedAt"       TIMESTAMPTZ,
  "reopenedAt"     TIMESTAMPTZ,

  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace-scoped sequential number — uniqueness lets us safely generate
-- the next number via SELECT MAX(...) + 1 in a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS "Ticket_workspaceId_ticketNumber_key"
  ON "Ticket"("workspaceId", "ticketNumber");

-- Inbox-style sort: workspace + status filter + recency.
CREATE INDEX IF NOT EXISTS "Ticket_workspaceId_status_lastActivityAt_idx"
  ON "Ticket"("workspaceId", "status", "lastActivityAt" DESC);

-- "Tickets assigned to me, by status" — drives the personal queue.
CREATE INDEX IF NOT EXISTS "Ticket_workspaceId_assignedUserId_status_idx"
  ON "Ticket"("workspaceId", "assignedUserId", "status");

-- Lookup by contact email for "show this contact's history."
CREATE INDEX IF NOT EXISTS "Ticket_workspaceId_contactEmail_idx"
  ON "Ticket"("workspaceId", "contactEmail");

-- ─── TicketMessage ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TicketMessage" (
  "id"           TEXT PRIMARY KEY,
  "ticketId"     TEXT NOT NULL REFERENCES "Ticket"("id") ON DELETE CASCADE,

  "direction"    TEXT NOT NULL,  -- 'inbound' | 'outbound' | 'internal_note'

  "fromEmail"    TEXT,
  "fromName"     TEXT,

  "body"         TEXT NOT NULL,
  "bodyHtml"     TEXT,

  "messageId"    TEXT,  -- RFC 5322 Message-ID header
  "inReplyTo"    TEXT,  -- RFC 5322 In-Reply-To header

  "sentByUserId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "sentAt"       TIMESTAMPTZ,

  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "TicketMessage_ticketId_createdAt_idx"
  ON "TicketMessage"("ticketId", "createdAt");

CREATE INDEX IF NOT EXISTS "TicketMessage_messageId_idx"
  ON "TicketMessage"("messageId");

-- ─── TicketingSettings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "TicketingSettings" (
  "workspaceId"        TEXT PRIMARY KEY REFERENCES "Workspace"("id") ON DELETE CASCADE,
  "enabled"            BOOLEAN NOT NULL DEFAULT FALSE,
  "autoCloseAfterDays" INTEGER NOT NULL DEFAULT 7,
  "autoReopenOnReply"  BOOLEAN NOT NULL DEFAULT TRUE,
  "fromEmail"          TEXT,
  "fromName"           TEXT,
  "signature"          TEXT,
  "updatedAt"          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Verification ───────────────────────────────────────────────────────────
SELECT 'Ticket exists'            AS check, to_regclass('"Ticket"')            IS NOT NULL AS ok
UNION ALL SELECT 'TicketMessage exists',     to_regclass('"TicketMessage"')     IS NOT NULL
UNION ALL SELECT 'TicketingSettings exists', to_regclass('"TicketingSettings"') IS NOT NULL;
