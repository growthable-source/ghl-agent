-- Agent.presetId — B2 (Agent Presets). Templates-only column, null for agents
-- created before B2 ships. Pasted by hand into the Supabase SQL editor.

ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "presetId" TEXT;
