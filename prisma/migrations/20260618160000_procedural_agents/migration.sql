-- Procedural vs reactive agent types. Additive + idempotent.
-- agentKind defaults to 'reactive' so every existing agent becomes reactive
-- (no step scaffolding) the moment this lands — fixes the "step 1 of 3" leak.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "agentKind" TEXT NOT NULL DEFAULT 'reactive';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "procedureMode" TEXT NOT NULL DEFAULT 'simple';

ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "procedureStepOrder" INTEGER;
ALTER TABLE "ConversationStateRecord" ADD COLUMN IF NOT EXISTS "procedureDoneAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "ProcedureStep" (
  "id"              TEXT NOT NULL,
  "agentId"         TEXT NOT NULL,
  "order"           INTEGER NOT NULL,
  "title"           TEXT NOT NULL,
  "instruction"     TEXT NOT NULL,
  "question"        TEXT,
  "collectFieldKey" TEXT,
  "rules"           JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcedureStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ProcedureStep_agentId_fkey" FOREIGN KEY ("agentId")
    REFERENCES "Agent"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ProcedureStep_agentId_order_idx" ON "ProcedureStep"("agentId", "order");
