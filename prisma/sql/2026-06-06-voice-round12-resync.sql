-- 2026-06-06 — Voice AI Round 12: force re-register with new system prompt
--
-- Round 10's SQL cleared vapiAssistantId once. Many agents have since
-- lazy-backfilled with the Round 10 system prompt + tool list. Round 12
-- restructures the prompt to make query_knowledge usage MANDATORY (hard
-- imperative at the top + repeat at the bottom) — without re-registering,
-- the assistant on Vapi's side still has the old, softer prompt.
--
-- Clearing vapiAssistantId again forces every voice agent to re-create
-- its assistant via ensureVapiAssistant() on the next save / call.

BEGIN;

UPDATE "VapiConfig" SET "vapiAssistantId" = NULL;

COMMIT;

-- Verify (read-only): right after running, every VapiConfig should have
-- a null vapiAssistantId. Within minutes of each agent's next save or
-- test call, the lazy backfill repopulates with the Round 12 prompt.
--
-- SELECT COUNT(*) FROM "VapiConfig" WHERE "vapiAssistantId" IS NOT NULL;
