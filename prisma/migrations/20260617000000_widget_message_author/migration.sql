-- Persist who authored a widget agent-message so server-rendered views
-- (brand portal transcript, inbox history) can show AI-vs-human
-- iconography. sentByUserId is set only when a human operator typed the
-- reply; NULL means the AI generated it. Idempotent.

ALTER TABLE "WidgetMessage" ADD COLUMN IF NOT EXISTS "sentByUserId" TEXT;

-- FK to the operator. ON DELETE SET NULL keeps the message (as an
-- unattributed human reply) if the user is later removed.
DO $$ BEGIN
  ALTER TABLE "WidgetMessage"
    ADD CONSTRAINT "WidgetMessage_sentByUserId_fkey"
    FOREIGN KEY ("sentByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
