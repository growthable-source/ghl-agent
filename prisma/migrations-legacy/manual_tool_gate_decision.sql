-- ToolGateDecision — B3 (Enforced Tool Gating). Audit log of every Haiku
-- gate check on an enforced tool. Pasted by hand into the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS "ToolGateDecision" (
  "id" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "conversationId" TEXT,
  "contactId" TEXT,
  "toolName" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "reason" TEXT,
  "latencyMs" INTEGER NOT NULL,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolGateDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ToolGateDecision_agentId_createdAt_idx"
  ON "ToolGateDecision"("agentId", "createdAt");

CREATE INDEX IF NOT EXISTS "ToolGateDecision_toolName_decision_idx"
  ON "ToolGateDecision"("toolName", "decision");

DO $$ BEGIN
  ALTER TABLE "ToolGateDecision"
    ADD CONSTRAINT "ToolGateDecision_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
