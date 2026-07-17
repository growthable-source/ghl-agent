-- Cross-tenant knowledge isolation fix: KnowledgeChunk uniqueness must be
-- scoped per-source, not global.
--
-- Bug: KnowledgeChunk had @@unique([sourceUrl, chunkIndex, contentVersion]).
-- That baked in a single-owner-per-URL assumption. When workspace B added a
-- URL workspace A had already indexed, the discover sweep in
-- lib/ingest/pipeline.ts saw "this URL already has live chunks" (true
-- GLOBALLY, across all sources/domains/workspaces) and skipped re-fetching
-- it — which is correct, we don't want to re-scrape and re-embed content we
-- already have. But processPage's existing-chunk lookup was ALSO global, so
-- workspace B's crawl "succeeded" with zero new chunks and B's
-- domain-scoped retrieval found nothing. Production incident: a demo agent
-- had an empty knowledge domain and hallucinated.
--
-- Fix (lib/ingest/pipeline.ts): keep skipping the fetch (that part was
-- deliberately added after the July 2026 runaway-recrawl incident — see the
-- comment above the discover sweep), but when the skipped URL's live chunks
-- belong to a DIFFERENT source, clone those chunk rows (content, embedding,
-- classification — no re-fetch/re-embed/re-classify cost) into the
-- requesting source/domain. Cloned rows get their own sourceId, so the
-- unique constraint must be scoped per-source or the clone's INSERT would
-- collide with the original row it's copying.
--
-- Run BY HAND in production (loose .sql — not auto-applied by migrate
-- deploy; see prisma/MIGRATIONS.md). Idempotent — safe to re-run.
--
-- Old index name below is the literal Prisma-generated name from the
-- CREATE TABLE in prisma/migrations-legacy/manual_phase2_knowledge_pipeline.sql
-- (line ~128): "KnowledgeChunk_sourceUrl_chunkIndex_contentVersion_key".
-- New index name follows the same Prisma convention (table_col1_col2_..._key)
-- for the new column list (sourceId, sourceUrl, chunkIndex, contentVersion).

DROP INDEX IF EXISTS "KnowledgeChunk_sourceUrl_chunkIndex_contentVersion_key";

CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeChunk_sourceId_sourceUrl_chunkIndex_contentVersion_key"
  ON "KnowledgeChunk"("sourceId", "sourceUrl", "chunkIndex", "contentVersion");
