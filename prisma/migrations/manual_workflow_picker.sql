-- Workflow picker fields on Agent
-- Idempotent: safe to re-run.
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "addToWorkflowsPick" JSONB;
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "removeFromWorkflowsPick" JSONB;
