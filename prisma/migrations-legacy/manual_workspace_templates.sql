-- ═══════════════════════════════════════════════════════════════════════════
-- AgentTemplate: workspace-scoped templates + full-config snapshot
--   workspaceId     — null = official/global template; set = workspace-scoped
--   config          — JSON blob with full agent config (persona, rules,
--                     qualifying, knowledge, triggers, follow-ups, stop
--                     conditions, voice) captured when user clicks
--                     "Save as template" on one of their agents
--   sourceAgentId   — optional back-reference for the UI
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "AgentTemplate"
  ADD COLUMN IF NOT EXISTS "workspaceId"   TEXT REFERENCES "Workspace"("id") ON DELETE CASCADE;

ALTER TABLE "AgentTemplate"
  ADD COLUMN IF NOT EXISTS "config"        JSONB;

ALTER TABLE "AgentTemplate"
  ADD COLUMN IF NOT EXISTS "sourceAgentId" TEXT;

CREATE INDEX IF NOT EXISTS "AgentTemplate_workspaceId_idx"
  ON "AgentTemplate"("workspaceId");
