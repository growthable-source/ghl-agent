-- Co-Pilot spoken language. Additive + idempotent.
-- Null means English (resolved in lib/copilot/language.ts). 'es' is
-- Spanish. Existing agents keep their current behavior (English)
-- until an operator picks Spanish.

ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "language" TEXT;
