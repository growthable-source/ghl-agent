-- KnowledgeCollection.kind: presentation grouping for the agent knowledge
-- picker — 'help_center' vs 'knowledge'. Purely cosmetic; retrieval is
-- unchanged.
ALTER TABLE "KnowledgeCollection" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'knowledge';

-- Backfill: the shared/global corpus (the Xovera/GHL base help center) and
-- every brand-scoped collection (a customer's own help center) present as
-- help centers. Everything else stays 'knowledge'. Operators can reclassify
-- any collection afterwards.
UPDATE "KnowledgeCollection"
SET "kind" = 'help_center'
WHERE "isGlobal" = TRUE OR "brandId" IS NOT NULL;
