-- Manual migration: remove the Phase-2 retrieval eval harness ("Test your AI")
-- ---------------------------------------------------------------------------
-- Run BY HAND in production (loose .sql — NOT picked up by `prisma migrate
-- deploy`). Drops the self-contained retrieval-eval models backing the
-- removed /insights/retrieval page + /api/admin/retrieval-evals routes.
-- CASCADE handles the inter-table + KnowledgeChunk/Brand/Workspace FKs, so
-- ordering does not matter. Wrapped in a transaction.
--
-- Nothing outside the eval harness writes these tables; dropping them does
-- not affect knowledge, brands, or agents.
-- ---------------------------------------------------------------------------

BEGIN;

DROP TABLE IF EXISTS "KnowledgeChunkEvalRef" CASCADE;
DROP TABLE IF EXISTS "RetrievalEvalResult"   CASCADE;
DROP TABLE IF EXISTS "RetrievalEvalRun"      CASCADE;
DROP TABLE IF EXISTS "RetrievalEvalQuery"    CASCADE;
DROP TABLE IF EXISTS "RetrievalEvalSet"      CASCADE;

COMMIT;
