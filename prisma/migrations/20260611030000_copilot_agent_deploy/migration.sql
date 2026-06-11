-- Co-Pilot agents: type, directions, and deploy fields. Idempotent.
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'support';
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "openingLine" TEXT;
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "collectInfo" TEXT;
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "publicKey" TEXT;
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "published" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CopilotAgent" ADD COLUMN IF NOT EXISTS "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE UNIQUE INDEX IF NOT EXISTS "CopilotAgent_publicKey_key" ON "CopilotAgent"("publicKey");
