-- Click-to-call widget type, inline embed mode, hosted call page slug,
-- and button styling fields. Additive — safe to run on prod.

ALTER TABLE "ChatWidget"
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'chat',
  ADD COLUMN IF NOT EXISTS "slug" TEXT,
  ADD COLUMN IF NOT EXISTS "embedMode" TEXT NOT NULL DEFAULT 'floating',
  ADD COLUMN IF NOT EXISTS "buttonLabel" TEXT NOT NULL DEFAULT 'Talk to us',
  ADD COLUMN IF NOT EXISTS "buttonShape" TEXT NOT NULL DEFAULT 'pill',
  ADD COLUMN IF NOT EXISTS "buttonSize" TEXT NOT NULL DEFAULT 'md',
  ADD COLUMN IF NOT EXISTS "buttonIcon" TEXT NOT NULL DEFAULT 'phone',
  ADD COLUMN IF NOT EXISTS "buttonTextColor" TEXT NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS "hostedPageHeadline" TEXT,
  ADD COLUMN IF NOT EXISTS "hostedPageSubtext" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ChatWidget_slug_key" ON "ChatWidget"("slug");
