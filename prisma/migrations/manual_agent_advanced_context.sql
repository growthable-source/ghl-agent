-- ═══════════════════════════════════════════════════════════════════════════
-- Agent: add agentType + businessContext for the "advanced context" agent
-- profile. SIMPLE agents keep today's behaviour (Contact name/tags only in
-- the system prompt). ADVANCED agents also load the contact's recent
-- opportunities (last 2 quarters) + custom fields + a per-agent business
-- glossary, so they can reason about commercial context without tool calls.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "agentType" TEXT NOT NULL DEFAULT 'SIMPLE';

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "businessContext" TEXT;

-- Existing rows default to SIMPLE via the column default. No data migration
-- needed — the ADVANCED path is purely additive and every read of these
-- fields is guarded by an agentType check.
