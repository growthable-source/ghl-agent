-- 2026-06-06 — Voice AI Round 14: migrate to standalone Tools + toolIds
--
-- Discovered via the Vapi dashboard: inline `model.tools[]` doesn't
-- dispatch at runtime — every assistant shows "No tools attached" on
-- the Tools tab and the webhook never gets hit. Vapi's runtime only
-- honours tools registered as standalone Tool entities (POST /tool)
-- and referenced from the assistant via `model.toolIds`.
--
-- Round 14 refactors buildVapiAssistantConfig to:
--   1. Find-or-create org-level Tool entities for query_knowledge, the
--      4 originals, the 7 Shopify tools (when connected), endCall built-in
--   2. Pass model.toolIds = [those ids] instead of inline model.tools
--   3. Idempotent — listing existing tools each sync prevents duplicates
--
-- Existing assistants on Vapi still have the inline (non-dispatching)
-- config. Clearing vapiAssistantId forces re-registration with the
-- new toolIds-based config on next save/call.

BEGIN;

UPDATE "VapiConfig" SET "vapiAssistantId" = NULL;

COMMIT;

-- Verification (read-only):
--
-- After running, every VapiConfig should have a null vapiAssistantId.
-- On the next save/call per agent, ensureVapiAssistant() re-registers
-- with the toolIds approach. Then on dashboard.vapi.ai the assistant's
-- Tools tab should list query_knowledge, book_appointment, etc.
--
-- SELECT COUNT(*) FROM "VapiConfig" WHERE "vapiAssistantId" IS NOT NULL;
