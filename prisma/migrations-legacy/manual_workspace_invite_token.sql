-- ─── Token-based workspace invites ──────────────────────────────────────────
-- Adds an opaque single-use token to WorkspaceInvite so invitees can accept
-- via /invite/<token> regardless of which Google account they're signed into.
--
-- Safe to re-run.

ALTER TABLE "WorkspaceInvite"
  ADD COLUMN IF NOT EXISTS "token" TEXT;

-- Backfill any existing pending invites with random tokens so the unique
-- constraint can be applied. cuid()-style — fast, URL-safe, single-use.
UPDATE "WorkspaceInvite"
SET "token" = substring(md5(random()::text || clock_timestamp()::text), 1, 24)
WHERE "token" IS NULL;

ALTER TABLE "WorkspaceInvite"
  ALTER COLUMN "token" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "WorkspaceInvite_token_key"
  ON "WorkspaceInvite" ("token");

CREATE INDEX IF NOT EXISTS "WorkspaceInvite_token_idx"
  ON "WorkspaceInvite" ("token");
