-- ═══════════════════════════════════════════════════════════════════════════
-- VapiConfig.ttsProvider — selects the TTS/voice adapter for an agent.
-- 'vapi' (default) uses Vapi + ElevenLabs; 'xai' uses Grok voices.
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE "VapiConfig"
  ADD COLUMN IF NOT EXISTS "ttsProvider" TEXT NOT NULL DEFAULT 'vapi';

-- Existing rows default to 'vapi' — no backfill needed.
