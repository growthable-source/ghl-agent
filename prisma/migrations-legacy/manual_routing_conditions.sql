-- ═══════════════════════════════════════════════════════════════════════════
-- RoutingRule.conditions — compound (AND/OR) routing conditions
--
-- Shape when populated:
--   { "clauses": [
--       { "ruleType": "ALL",  "values": [] },
--       { "ruleType": "TAG",  "values": ["hot-lead", "vip"] }
--     ] }
--   - All clauses must match (AND)
--   - Any value within a clause matches (OR)
--
-- Legacy `ruleType`/`value` columns stay — the evaluator falls back to them
-- when `conditions` is null, so existing rules keep working unchanged.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "RoutingRule" ADD COLUMN IF NOT EXISTS "conditions" JSONB;
