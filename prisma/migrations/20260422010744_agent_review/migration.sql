-- Meta-Claude review thread: an admin opens a specific (agent, contact)
-- conversation and chats with a reviewer Claude about what the agent did
-- wrong. Messages accumulate in the JSON column; kept forever as training
-- signal. Idempotent.
CREATE TABLE IF NOT EXISTS "AgentReview" (
  "id"             TEXT NOT NULL,
  "agentId"        TEXT NOT NULL,
  "contactId"      TEXT NOT NULL,
  "conversationId" TEXT,
  "adminId"        TEXT,
  "adminEmail"     TEXT NOT NULL,
  "title"          TEXT,
  "messages"       JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentReview_pkey" PRIMARY KEY ("id")
);

-- Cascade with the agent row; null out the admin on delete so we keep
-- audit context when an admin is removed.
DO $$ BEGIN
  ALTER TABLE "AgentReview"
    ADD CONSTRAINT "AgentReview_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "AgentReview"
    ADD CONSTRAINT "AgentReview_adminId_fkey"
    FOREIGN KEY ("adminId") REFERENCES "SuperAdmin"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "AgentReview_agentId_createdAt_idx"
  ON "AgentReview"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentReview_contactId_createdAt_idx"
  ON "AgentReview"("contactId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "AgentReview_adminId_createdAt_idx"
  ON "AgentReview"("adminId", "createdAt" DESC);
