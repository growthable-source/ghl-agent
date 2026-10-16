ALTER TABLE "CopilotAgent"
ADD COLUMN "addressAliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "CopilotTelemetryBatch" (
  "sessionId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CopilotTelemetryBatch_pkey" PRIMARY KEY ("sessionId", "batchId")
);

CREATE INDEX "CopilotTelemetryBatch_createdAt_idx"
ON "CopilotTelemetryBatch"("createdAt");

ALTER TABLE "CopilotTelemetryBatch"
ADD CONSTRAINT "CopilotTelemetryBatch_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "CopilotSession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
