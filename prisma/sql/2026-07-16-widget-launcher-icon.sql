-- Widget launcher icon customization. Run by hand in production
-- (Ryan's workflow — nothing auto-runs).
--
-- Context: the floating chat bubble was always a hardcoded chat glyph on
-- the primary color. Operators can now pick what it shows: the classic
-- chat bubble, a "?" mark, a Gmail-style letter mark (A–Z, defaults to
-- the widget title's initial), or the uploaded logo image filling the
-- circle. Two new ChatWidget columns; every runtime read is tolerant of
-- them being absent, so this can be applied any time after deploy.

ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "launcherIcon" TEXT NOT NULL DEFAULT 'chat';
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "launcherLetter" TEXT;
