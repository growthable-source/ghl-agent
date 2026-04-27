-- Weekly digest emails: per-user opt-in flag on workspace membership +
-- a sent-at timestamp so re-runs of the cron don't double-send. Additive.

ALTER TABLE "WorkspaceMember"
  ADD COLUMN IF NOT EXISTS "digestOptIn"      BOOLEAN     NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "lastDigestSentAt" TIMESTAMP;
