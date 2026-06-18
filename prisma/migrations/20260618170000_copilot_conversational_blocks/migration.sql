-- Co-Pilot conversational building blocks (Advanced mode). Additive +
-- idempotent. procedureMode defaults to 'simple' so every existing
-- co-pilot agent keeps its flat checklist behavior unchanged.

ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "procedureMode" TEXT NOT NULL DEFAULT 'simple';
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "blocks" JSONB NOT NULL DEFAULT '[]'::jsonb;
