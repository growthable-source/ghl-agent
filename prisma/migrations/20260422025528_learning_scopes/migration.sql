-- PR 2 of the feedback-loop pipeline. Adds the plumbing for workspace-
-- and platform-scoped learnings:
--   * Workspace.disableGlobalLearnings — per-tenant opt-out kill switch
--   * PlatformLearning.workspaceId — denormalised for the hot-path query
--     that buildSystemPrompt runs on every inbound ("give me every
--     applied learning that targets this agent's workspace").
--   * Two new indexes on PlatformLearning so the runtime lookup doesn't
--     scan the table as the queue grows.
-- Idempotent.

ALTER TABLE "Workspace"
  ADD COLUMN IF NOT EXISTS "disableGlobalLearnings" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PlatformLearning"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "PlatformLearning_scope_status_idx"
  ON "PlatformLearning"("scope", "status");
CREATE INDEX IF NOT EXISTS "PlatformLearning_workspaceId_status_idx"
  ON "PlatformLearning"("workspaceId", "status");
