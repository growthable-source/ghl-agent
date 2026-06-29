-- Out-of-band retry for inbounds dropped by a transient model-provider outage.
-- Run by hand in production (Ryan's workflow — nothing auto-runs).
--
-- Context: when the LLM call fails, runAgent now classifies the failure as
-- transient (model_unavailable) or permanent (model_rejected). Transient CRM
-- inbounds are marked ERROR + scheduled for an automatic retry by the
-- retry-model-failures cron, which replays the agent and pages a human only
-- after retries are exhausted. These four columns + index back that schedule.
--
-- Until this SQL runs, the app degrades safely: recordUnansweredSkip() can't
-- write modelRetryAt, so it falls back to paging immediately (the pre-Phase-2
-- behavior), and the cron returns {skippedMigration:true} instead of erroring.
-- No inbound is ever silently dropped in the meantime.
--
-- All statements are idempotent (IF NOT EXISTS) — safe to re-run.

BEGIN;

ALTER TABLE "MessageLog"
  ADD COLUMN IF NOT EXISTS "channel" TEXT,
  ADD COLUMN IF NOT EXISTS "conversationProviderId" TEXT,
  ADD COLUMN IF NOT EXISTS "modelRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "modelRetryCount" INTEGER NOT NULL DEFAULT 0;

-- The cron selects WHERE status='ERROR' AND modelRetryAt <= now().
CREATE INDEX IF NOT EXISTS "MessageLog_modelRetryAt_idx" ON "MessageLog"("modelRetryAt");

COMMIT;
