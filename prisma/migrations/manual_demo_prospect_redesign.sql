-- Website-redesign offer on the demo-prospect funnel (hand-run; matches the
-- DemoProspect model in schema.prisma). Run once in production.
--
-- Same row, second offer: a prospect registered with vertical 'redesign'
-- lands on /redesign/[slug] instead of /try/[slug], sees a review of their
-- current site, and asks for a free rebuild. These three columns carry that
-- request from the landing page to the queue and back out as a delivery.

ALTER TABLE "DemoProspect"
  ADD COLUMN IF NOT EXISTS "redesignRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "redesignContact"     JSONB,
  ADD COLUMN IF NOT EXISTS "previewUrl"          TEXT;

-- The work queue reads open requests oldest-first.
CREATE INDEX IF NOT EXISTS "DemoProspect_redesignRequestedAt_idx"
  ON "DemoProspect" ("redesignRequestedAt");
