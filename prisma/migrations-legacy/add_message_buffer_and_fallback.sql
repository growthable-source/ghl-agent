-- Message buffer for SMS debouncing
CREATE TABLE IF NOT EXISTS "MessageBuffer" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "locationId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MessageBuffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MessageBuffer_locationId_contactId_processed_createdAt_idx"
    ON "MessageBuffer"("locationId", "contactId", "processed", "createdAt" ASC);

-- Follow-up sequence trigger rules
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "triggerType" TEXT NOT NULL DEFAULT 'always';
ALTER TABLE "FollowUpSequence" ADD COLUMN IF NOT EXISTS "triggerValue" TEXT;

-- Agent qualifying style + fallback behavior fields
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "qualifyingStyle" TEXT NOT NULL DEFAULT 'strict';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "fallbackBehavior" TEXT NOT NULL DEFAULT 'message';
ALTER TABLE "Agent" ADD COLUMN IF NOT EXISTS "fallbackMessage" TEXT;
