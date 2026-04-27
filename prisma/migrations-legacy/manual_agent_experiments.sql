-- Agent Self-Experimentation: A/B test opening lines and persona variants
-- against the existing AgentGoal/AgentGoalEvent metric pipeline. Additive.

CREATE TABLE IF NOT EXISTS "AgentExperiment" (
  "id"              TEXT PRIMARY KEY,
  "agentId"         TEXT NOT NULL,
  "hypothesis"      TEXT NOT NULL,
  "variantALabel"   TEXT NOT NULL DEFAULT 'control',
  "variantBLabel"   TEXT NOT NULL DEFAULT 'variant-b',
  "variantAPrompt"  TEXT,
  "variantBPrompt"  TEXT NOT NULL,
  "metric"          TEXT NOT NULL DEFAULT 'any_goal',
  "splitPercent"    INT  NOT NULL DEFAULT 50,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "proposedBy"      TEXT,
  "proposedAt"      TIMESTAMP NOT NULL DEFAULT NOW(),
  "approvedBy"      TEXT,
  "approvedAt"      TIMESTAMP,
  "startedAt"       TIMESTAMP,
  "endedAt"         TIMESTAMP,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "AgentExperiment_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentExperiment_agentId_status_idx"
  ON "AgentExperiment"("agentId", "status");

CREATE TABLE IF NOT EXISTS "AgentExperimentEvent" (
  "id"            TEXT PRIMARY KEY,
  "experimentId"  TEXT NOT NULL,
  "contactId"     TEXT NOT NULL,
  "variant"       TEXT NOT NULL,           -- 'A' | 'B'
  "outcome"       TEXT NOT NULL,           -- 'exposed' | 'converted'
  "goalEventId"   TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "AgentExperimentEvent_experimentId_fkey"
    FOREIGN KEY ("experimentId") REFERENCES "AgentExperiment"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "AgentExperimentEvent_experimentId_variant_outcome_idx"
  ON "AgentExperimentEvent"("experimentId", "variant", "outcome");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentExperimentEvent_experimentId_contactId_outcome_key"
  ON "AgentExperimentEvent"("experimentId", "contactId", "outcome");
