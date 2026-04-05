-- ScheduledMessage table for ad-hoc follow-up messages
CREATE TABLE IF NOT EXISTS "ScheduledMessage" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "agentId" TEXT,
    "contactId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'SMS',
    "message" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ScheduledMessage_status_scheduledAt_idx" ON "ScheduledMessage"("status", "scheduledAt");
CREATE INDEX IF NOT EXISTS "ScheduledMessage_locationId_contactId_idx" ON "ScheduledMessage"("locationId", "contactId");

-- LeadScore table for AI-generated lead scores
CREATE TABLE IF NOT EXISTS "LeadScore" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScore_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LeadScore_agentId_contactId_key" ON "LeadScore"("agentId", "contactId");
CREATE INDEX IF NOT EXISTS "LeadScore_locationId_score_idx" ON "LeadScore"("locationId", "score" DESC);
