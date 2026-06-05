-- Vapi assistant registration + browser test-call diagnostics.
-- Idempotent — safe to re-run.

-- 1. vapiAssistantId column on VapiConfig. Pre-registered Vapi
--    assistants replace the inline transient assistant configs that
--    were failing with "Meeting ended due to ejection" on browser
--    test calls. Unique because Vapi assistant ids are 1:1 with
--    VapiConfig rows.
ALTER TABLE "VapiConfig" ADD COLUMN IF NOT EXISTS "vapiAssistantId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "VapiConfig_vapiAssistantId_key"
  ON "VapiConfig"("vapiAssistantId");

-- 2. Diagnostic table for browser test-call failures. The daily-co
--    transport reports failures as a generic "Meeting has ended" —
--    we capture the full error payload here for inspection.
CREATE TABLE IF NOT EXISTS "VoiceTestCallDiagnostic" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "agentId" TEXT NOT NULL,
  "vapiAssistantId" TEXT,
  "errorType" TEXT,
  "errorPayload" JSONB,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VoiceTestCallDiagnostic_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VoiceTestCallDiagnostic_agentId_idx"
  ON "VoiceTestCallDiagnostic"("agentId");

CREATE INDEX IF NOT EXISTS "VoiceTestCallDiagnostic_workspaceId_createdAt_idx"
  ON "VoiceTestCallDiagnostic"("workspaceId", "createdAt");
