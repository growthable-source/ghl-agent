-- Voice: human transfer + voicemail script + test-call logging.
-- Idempotent — safe to re-run.

-- 1. transferPhoneNumber: E.164 number the agent can hand the call to
--    via Vapi's built-in transferCall tool. Null = transfer disabled
--    (and the tool is not registered on the assistant).
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "transferPhoneNumber" TEXT;

-- 2. voicemailMessage: what the agent says when an outbound call hits
--    an answering machine. The builder previously read this field via
--    an `as any` cast against a column that never existed — it always
--    fell back to the hardcoded default.
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "voicemailMessage" TEXT;

-- 3. CallLog.locationId becomes nullable. Browser test calls and
--    widget voice calls have no CRM location; requiring one meant those
--    calls were never logged (and their minutes never counted).
ALTER TABLE "CallLog" ALTER COLUMN "locationId" DROP NOT NULL;
