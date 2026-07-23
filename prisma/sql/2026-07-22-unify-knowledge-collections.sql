-- Unify knowledge under Collections.
--
-- Before: two parallel systems on one page — KnowledgeDomain/KnowledgeSource
-- (crawled → chunked → retrieved) and KnowledgeCollection/KnowledgeEntry
-- (written → stuffed into the prompt). Operators saw both, could group only
-- one, and could share only the half that mattered least.
--
-- After: KnowledgeCollection is the ONLY container. It holds written entries
-- AND live sources. Agents attach collections and nothing else.
-- KnowledgeDomain survives purely as the internal storage anchor for chunks.
--
-- Safe to re-run. Run BEFORE the deploy lands if you can — until step 1
-- exists, the Knowledge page's source list and agent scoping fall back to
-- workspace-wide (nothing breaks, nothing is lost, grouping just isn't
-- visible yet).

-- ── 1. Sources belong to a collection ────────────────────────────────────
ALTER TABLE "KnowledgeSource"
  ADD COLUMN IF NOT EXISTS "collectionId" TEXT;

CREATE INDEX IF NOT EXISTS "KnowledgeSource_collectionId_idx"
  ON "KnowledgeSource" ("collectionId");

DO $$
BEGIN
  ALTER TABLE "KnowledgeSource"
    ADD CONSTRAINT "KnowledgeSource_collectionId_fkey"
    FOREIGN KEY ("collectionId") REFERENCES "KnowledgeCollection"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Every workspace that has sources gets a landing collection ────────
-- Brand-scoped domains get their own brand collection so portal knowledge
-- stays separable; everything else lands in "General knowledge".

-- 2a. Brand collections for brand-scoped domains that don't have one.
INSERT INTO "KnowledgeCollection" ("id", "workspaceId", "brandId", "name", "description", "icon", "order", "createdAt", "updatedAt")
SELECT
  'kc_brand_' || substr(md5(random()::text || d."brandId"), 1, 20),
  d."workspaceId",
  d."brandId",
  b."name" || ' — portal knowledge',
  'Added by portal users for this brand.',
  '🏷️',
  0,
  NOW(),
  NOW()
FROM "KnowledgeDomain" d
JOIN "Brand" b ON b.id = d."brandId"
WHERE d."brandId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "KnowledgeCollection" c WHERE c."brandId" = d."brandId"
  );

-- 2b. A "General knowledge" collection per workspace that has non-brand
--     sources but no collection to put them in.
--
--     The DISTINCT must happen in a subquery BEFORE the id is built:
--     random() is evaluated per row, so a DISTINCT over an expression
--     containing it never dedupes and a workspace with N sources would
--     get N identical collections.
INSERT INTO "KnowledgeCollection" ("id", "workspaceId", "name", "description", "icon", "color", "order", "createdAt", "updatedAt")
SELECT
  'kc_gen_' || substr(md5(random()::text || t.ws), 1, 20),
  t.ws,
  'General knowledge',
  'Everything added from the Knowledge page. Agents read this by default.',
  '📚',
  '#fa4d2e',
  0,
  NOW(),
  NOW()
FROM (
  SELECT DISTINCT d."workspaceId" AS ws
  FROM "KnowledgeDomain" d
  JOIN "KnowledgeSource" s ON s."knowledgeDomainId" = d.id
  WHERE d."brandId" IS NULL
    AND s."collectionId" IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "KnowledgeCollection" c
      WHERE c."workspaceId" = d."workspaceId" AND c."brandId" IS NULL
    )
) t;

-- ── 3. Assign every unassigned source to a collection ────────────────────
-- 3a. Brand-scoped sources → that brand's collection.
UPDATE "KnowledgeSource" s
SET "collectionId" = c.id
FROM "KnowledgeDomain" d
JOIN "KnowledgeCollection" c ON c."brandId" = d."brandId"
WHERE s."knowledgeDomainId" = d.id
  AND d."brandId" IS NOT NULL
  AND s."collectionId" IS NULL;

-- 3b. Everything else → the workspace's oldest non-brand collection
--     (the "General knowledge" row from 2b, or whatever the workspace
--     already had if it was organising knowledge by hand).
UPDATE "KnowledgeSource" s
SET "collectionId" = pick.id
FROM "KnowledgeDomain" d
JOIN LATERAL (
  SELECT c.id
  FROM "KnowledgeCollection" c
  WHERE c."workspaceId" = d."workspaceId"
    AND c."brandId" IS NULL
  ORDER BY c."order" ASC, c."createdAt" ASC
  LIMIT 1
) pick ON TRUE
WHERE s."knowledgeDomainId" = d.id
  AND s."collectionId" IS NULL;

-- ── 4. Preserve per-agent scoping ────────────────────────────────────────
-- Agents with knowledgeScopeAll = true (the default) need nothing: they read
-- every collection, exactly as they read every domain before.
--
-- Agents that were explicitly narrowed (knowledgeScopeAll = false) must keep
-- reading the collections their scoped domains' sources now live in, on top
-- of whatever collections they already had attached.
-- Same random()/DISTINCT trap as 2b, but here it's fatal rather than
-- untidy: AgentCollection has @@unique([agentId, collectionId]), so
-- duplicate rows abort the whole migration. Dedupe first, build ids after.
INSERT INTO "AgentCollection" ("id", "agentId", "collectionId", "attachedAt")
SELECT
  'ac_' || substr(md5(random()::text || t."agentId" || t."collectionId"), 1, 22),
  t."agentId",
  t."collectionId",
  NOW()
FROM (
  SELECT DISTINCT a.id AS "agentId", s."collectionId" AS "collectionId"
  FROM "Agent" a
  JOIN "KnowledgeSource" s ON s."collectionId" IS NOT NULL
  JOIN "KnowledgeDomain" d ON d.id = s."knowledgeDomainId"
  WHERE a."knowledgeScopeAll" = false
    AND d.id = ANY(a."knowledgeDomainIds")
    AND NOT EXISTS (
      SELECT 1 FROM "AgentCollection" ac
      WHERE ac."agentId" = a.id AND ac."collectionId" = s."collectionId"
    )
) t;

-- ── 5. Usage triggers re-key from domain id → collection id ──────────────
-- Agent.knowledgeConditions was keyed by whichever source the operator set a
-- trigger on. Domain-keyed entries move to the collection that domain's
-- sources landed in. The runtime falls back to the domain key anyway, so
-- this is tidiness rather than a correctness fix.
UPDATE "Agent" a
SET "knowledgeConditions" = (a."knowledgeConditions" - d.id) || jsonb_build_object(pick."collectionId", a."knowledgeConditions" -> d.id)
FROM "KnowledgeDomain" d
JOIN LATERAL (
  SELECT s."collectionId"
  FROM "KnowledgeSource" s
  WHERE s."knowledgeDomainId" = d.id AND s."collectionId" IS NOT NULL
  LIMIT 1
) pick ON TRUE
WHERE a."knowledgeConditions" ? d.id
  AND d."workspaceId" = a."workspaceId";

-- ── 6. Deprecated ────────────────────────────────────────────────────────
-- Agent.knowledgeDomainIds is no longer read by the text/voice/widget agent
-- runtime (collections drive scope now). Left in place — Copilot agents and
-- the /try demo prospects still scope by domain, and dropping it would break
-- the rollback path. Do not remove without auditing lib/copilot/*.
