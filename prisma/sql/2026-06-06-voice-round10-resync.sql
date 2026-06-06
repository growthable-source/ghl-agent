-- 2026-06-06 — Voice AI Round 10: re-sync every voice agent
--
-- Round 10 adds two things to the registered Vapi assistant config:
--   1. A `query_knowledge` tool the model calls mid-call to vector-search
--      the workspace's indexed content (replaces the 30-entry static
--      bake-in that silently dropped 99% of large knowledge collections).
--   2. The 7 Shopify tools (search_shopify_products, check_shopify_inventory,
--      lookup_shopify_customer, check_shopify_order_status,
--      create_shopify_checkout, create_shopify_discount,
--      record_back_in_stock_interest) — conditionally registered when
--      the workspace has Shopify connected.
--
-- The system prompt also changes: ambient knowledge is now 5 newest-first
-- entries (was unsorted 30), an instruction to call query_knowledge is
-- injected, and buildVoiceCommerceBlock is appended on Shopify-connected
-- workspaces.
--
-- Existing registered assistants on Vapi don't have these tools. Clearing
-- vapiAssistantId here forces ensureVapiAssistant() to re-register on
-- next save or call with the new tool list + prompt. Safe to re-run.

BEGIN;

UPDATE "VapiConfig" SET "vapiAssistantId" = NULL;

COMMIT;

-- Verification (read-only):
--
-- Right after running this, every VapiConfig should have a null
-- vapiAssistantId. Within minutes of each agent's next save / call,
-- the lazy backfill will repopulate.
--
-- SELECT COUNT(*) FROM "VapiConfig" WHERE "vapiAssistantId" IS NOT NULL;
