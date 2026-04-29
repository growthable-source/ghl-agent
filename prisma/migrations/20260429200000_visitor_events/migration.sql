-- Visitor activity stream + denormalized "current page" on the
-- visitor row. Powers the inbox-sidebar Timeline panel and the
-- "Visitor is on …" hint at the top of the panel.
--
-- All additive — existing visitors get NULL currentUrl/currentTitle
-- until their next page_view event lands.

ALTER TABLE "WidgetVisitor"
  ADD COLUMN IF NOT EXISTS "currentUrl"   TEXT,
  ADD COLUMN IF NOT EXISTS "currentTitle" TEXT;

CREATE TABLE IF NOT EXISTS "WidgetVisitorEvent" (
  "id"        TEXT PRIMARY KEY,
  "visitorId" TEXT NOT NULL,
  "kind"      TEXT NOT NULL,
  "data"      JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS "WidgetVisitorEvent_visitorId_createdAt_idx"
  ON "WidgetVisitorEvent"("visitorId", "createdAt" DESC);

DO $$ BEGIN
  ALTER TABLE "WidgetVisitorEvent"
    ADD CONSTRAINT "WidgetVisitorEvent_visitorId_fkey"
    FOREIGN KEY ("visitorId") REFERENCES "WidgetVisitor"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
