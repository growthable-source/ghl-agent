-- ─── Per-message language + English translation ──────────────────────────
-- The agent replies in the visitor's language automatically (via a system
-- prompt directive). For operator visibility, every non-English message
-- (both visitor and agent) gets a Haiku translation persisted here. The
-- inbox renders the translation under the original so a monolingual
-- operator can follow the thread.
--
-- Safe to re-run.

ALTER TABLE "WidgetMessage"
  ADD COLUMN IF NOT EXISTS "language"      TEXT,
  ADD COLUMN IF NOT EXISTS "translationEn" TEXT;
