-- Add optional hosted logo image to Workspace. Emoji icon remains as the
-- fallback — the UI prefers logoUrl when both are set. Idempotent.
ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "logoUrl" TEXT;
