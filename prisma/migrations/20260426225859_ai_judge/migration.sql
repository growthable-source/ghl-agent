-- AI Judge: pre-screen messages flagged for approval with a cheap LLM call.
-- Adds judge config to Agent + verdict columns to MessageLog. Additive.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "judgeEnabled"      BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "judgeModel"        TEXT NOT NULL DEFAULT 'haiku',
  ADD COLUMN IF NOT EXISTS "judgeAutoSend"     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "judgeAutoBlock"    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "judgeInstructions" TEXT;

ALTER TABLE "MessageLog"
  ADD COLUMN IF NOT EXISTS "judgeVerdict" TEXT,    -- safe | unsafe | uncertain
  ADD COLUMN IF NOT EXISTS "judgeReason"  TEXT,
  ADD COLUMN IF NOT EXISTS "judgeModel"   TEXT;
