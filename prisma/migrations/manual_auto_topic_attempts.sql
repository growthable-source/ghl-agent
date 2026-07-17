-- Auto-topics retry cap (Jul 2026 Haiku token burn fix).
--
-- Tracks how many times autoOrganizeTopics has shown a chunk to the model
-- without managing to tag it. Chunks that hit the cap (3, in code) are
-- treated as unclassifiable and skipped by both autoOrganizeTopics and the
-- ingest-queue idle backstop. Without this, ~31 untaggable chunks kept the
-- backstop firing a Haiku call every idle minute — several million tokens
-- a day going nowhere.
--
-- Code is tolerant of this column being absent (falls back to the old
-- behaviour), so deploy order doesn't matter — but the burn only stops
-- once this has been run.

ALTER TABLE "KnowledgeChunk" ADD COLUMN IF NOT EXISTS "autoTopicAttempts" INTEGER NOT NULL DEFAULT 0;

-- Retroactively retire the current stuck buckets: anything untagged today
-- has already been retried far past 3 attempts by the pre-fix loop.
UPDATE "KnowledgeChunk"
SET "autoTopicAttempts" = 3
WHERE "supersededAt" IS NULL
  AND ("taxonomyTags" IS NULL OR cardinality("taxonomyTags") = 0);
