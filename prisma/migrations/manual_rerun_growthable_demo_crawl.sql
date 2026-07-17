-- Remediation for the growthable-f52a02dd demo agent (production incident,
-- 2026-07-17): its knowledge domain crawled "successfully" with zero
-- chunks because the pages it linked to were already indexed under a
-- DIFFERENT workspace's KnowledgeSource — the global sourceUrl dedupe in
-- lib/ingest/pipeline.ts skipped re-fetching them and (pre-fix) never
-- copied anything into this domain, so retrieval found nothing and the
-- agent hallucinated. Fixed by the copy-on-dedupe change (see
-- lib/ingest/pipeline.ts + prisma/migrations/manual_chunk_unique_per_source.sql).
--
-- This queues a fresh IngestionRun for that demo's crawl source so the
-- every-minute ingest-queue cron (app/api/cron/ingest-queue/route.ts) picks
-- it up post-deploy. With the fix live, the discover sweep will find the
-- already-indexed chunks under the other source and CLONE them (content +
-- embedding + classification, no re-fetch/re-embed/re-classify) into this
-- source/domain instead of leaving it empty.
--
-- Run BY HAND in production AFTER the copy-on-dedupe fix has deployed.
-- Guarded against double-queuing: no-ops if a queued/running run already
-- exists for the source, so it's safe to re-run this file.

INSERT INTO "IngestionRun" (id, "sourceId", status)
SELECT gen_random_uuid()::text, ks.id, 'queued'
FROM "KnowledgeSource" ks
WHERE ks."knowledgeDomainId" = (
  SELECT dp."knowledgeDomainId"
  FROM "DemoProspect" dp
  WHERE dp.slug = 'growthable-f52a02dd'
)
AND NOT EXISTS (
  SELECT 1 FROM "IngestionRun" ir
  WHERE ir."sourceId" = ks.id AND ir.status IN ('queued', 'running')
);
