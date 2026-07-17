-- Ticket-email delivery failure tracking + retry scheduling.
-- Run by hand in production (matches the manual_*.sql workflow).
--
-- Before this, a failed Resend send left the TicketMessage looking sent
-- (sentAt null is also what sendEmail=false produces), nothing retried,
-- and operators only found out when the customer complained.

ALTER TABLE "TicketMessage" ADD COLUMN IF NOT EXISTS "emailError" TEXT;
ALTER TABLE "TicketMessage" ADD COLUMN IF NOT EXISTS "emailAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TicketMessage" ADD COLUMN IF NOT EXISTS "emailNextRetryAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "TicketMessage_emailNextRetryAt_idx" ON "TicketMessage"("emailNextRetryAt");
