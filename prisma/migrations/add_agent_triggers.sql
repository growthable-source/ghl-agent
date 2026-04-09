-- Add AgentTrigger table for event-driven outbound messaging
CREATE TABLE IF NOT EXISTS "AgentTrigger" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "agentId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "tagFilter" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "messageMode" TEXT NOT NULL DEFAULT 'AI_GENERATE',
    "fixedMessage" TEXT,
    "aiInstructions" TEXT,
    "delaySeconds" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AgentTrigger_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AgentTrigger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "AgentTrigger_agentId_idx" ON "AgentTrigger"("agentId");
CREATE INDEX IF NOT EXISTS "AgentTrigger_eventType_isActive_idx" ON "AgentTrigger"("eventType", "isActive");
