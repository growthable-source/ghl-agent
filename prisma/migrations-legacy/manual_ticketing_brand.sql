-- ============================================================================
-- TICKETING: add brand for reporting / filtering / grouping.
-- ============================================================================
-- Tickets get a denormalised brandId so the reports + list filters can
-- query/group/sort by brand without walking conversation → widget → brand.
-- Stamped at promote time going forward; backfilled for existing tickets
-- via the same join.
-- ============================================================================

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "brandId" TEXT
    REFERENCES "Brand"("id") ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "Ticket_workspaceId_brandId_status_idx"
  ON "Ticket"("workspaceId", "brandId", "status");

-- Backfill: any existing ticket promoted from a conversation gets its
-- brandId stamped from the source widget. Tickets with no source
-- conversation (cold inbound, manual create) stay null.
UPDATE "Ticket" t
SET "brandId" = w."brandId"
FROM "WidgetConversation" c
JOIN "ChatWidget" w ON w.id = c."widgetId"
WHERE t."conversationId" = c.id
  AND t."brandId" IS NULL
  AND w."brandId" IS NOT NULL;

-- Verification
SELECT
  COUNT(*)                                                AS total_tickets,
  COUNT(*) FILTER (WHERE "brandId" IS NOT NULL)           AS with_brand,
  COUNT(*) FILTER (WHERE "brandId" IS NULL)               AS without_brand
FROM "Ticket";
