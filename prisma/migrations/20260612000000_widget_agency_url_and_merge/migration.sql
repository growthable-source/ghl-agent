-- Live-chat batch: whitelabel agency URL + conversation merge. Idempotent.

-- Operator-facing whitelabel/agency URL per widget. Surfaced in the inbox
-- conversation panel as a one-click "open the client's site" link.
ALTER TABLE "ChatWidget" ADD COLUMN IF NOT EXISTS "agencyUrl" TEXT;

-- Marks a conversation merged INTO another (returning visitor, same issue,
-- new session). Points at the surviving target conversation.
ALTER TABLE "WidgetConversation" ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;
