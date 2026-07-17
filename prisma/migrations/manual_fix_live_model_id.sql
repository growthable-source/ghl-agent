-- Fix stored Gemini Live model ids (hand-run).
-- `gemini-3.1-flash-live` is rejected by the Live API (WS close 1008:
-- not found / not supported for bidiGenerateContent). The working id —
-- what the copilot runtime uses in production — is the `-preview`
-- variant. Rows created while the bad default shipped (including the
-- /try demo agents and any claimed ones) carry it. The app also
-- self-heals this at session-build time (normalizeGeminiVoiceModel),
-- so this is data hygiene, not a hard dependency.
UPDATE "GeminiVoiceConfig"
SET "model" = 'gemini-3.1-flash-live-preview'
WHERE "model" = 'gemini-3.1-flash-live';
