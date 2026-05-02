-- Use the GHL webhook messageId as a true idempotency key. Previously we
-- relied on a tower of timing guards (3s debounce + 90s in-flight lock +
-- 6s recent-assistant lock) which let GHL retries through whenever the
-- agent run took just long enough for one window to expire — producing
-- back-to-back replies to a single inbound. A unique index here makes the
-- duplicate webhook fail fast at insert time.
ALTER TABLE "MessageBuffer" ADD COLUMN "messageId" TEXT;
CREATE UNIQUE INDEX "MessageBuffer_messageId_key" ON "MessageBuffer"("messageId");
