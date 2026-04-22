-- Platform learnings: concrete suggestions proposed by the meta-Claude
-- reviewer and either approved/applied/rejected/retired by admins. This
-- is the first step of the feedback pipeline — turning critique into
-- apply-able changes. Idempotent.
CREATE TABLE IF NOT EXISTS "PlatformLearning" (
  "id"              TEXT NOT NULL,
  "sourceReviewId"  TEXT,
  "scope"           TEXT NOT NULL DEFAULT 'this_agent',
  "agentId"         TEXT,
  "type"            TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "content"         TEXT NOT NULL,
  "rationale"       TEXT,
  "status"          TEXT NOT NULL DEFAULT 'proposed',
  "proposedByEmail" TEXT NOT NULL,
  "approvedByEmail" TEXT,
  "rejectedByEmail" TEXT,
  "rejectedReason"  TEXT,
  "appliedAt"       TIMESTAMP(3),
  "appliedTarget"   TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformLearning_pkey" PRIMARY KEY ("id")
);

-- Source review FK: keep the row even if the review is deleted so the
-- audit history survives. We just lose the link back.
DO $$ BEGIN
  ALTER TABLE "PlatformLearning"
    ADD CONSTRAINT "PlatformLearning_sourceReviewId_fkey"
    FOREIGN KEY ("sourceReviewId") REFERENCES "AgentReview"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Agent FK: cascade — if the agent is deleted, its learnings go with
-- it. They were scoped to that agent's prompt anyway.
DO $$ BEGIN
  ALTER TABLE "PlatformLearning"
    ADD CONSTRAINT "PlatformLearning_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "PlatformLearning_agentId_status_idx"
  ON "PlatformLearning"("agentId", "status");
CREATE INDEX IF NOT EXISTS "PlatformLearning_status_createdAt_idx"
  ON "PlatformLearning"("status", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "PlatformLearning_sourceReviewId_idx"
  ON "PlatformLearning"("sourceReviewId");
