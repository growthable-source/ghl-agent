-- Channel deployment table — links agents to messaging channels
CREATE TABLE IF NOT EXISTS "ChannelDeployment" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "agentId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChannelDeployment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ChannelDeployment_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Unique constraint: one deployment per agent per channel
CREATE UNIQUE INDEX IF NOT EXISTS "ChannelDeployment_agentId_channel_key" ON "ChannelDeployment"("agentId", "channel");

-- Index for fast lookups by channel
CREATE INDEX IF NOT EXISTS "ChannelDeployment_channel_isActive_idx" ON "ChannelDeployment"("channel", "isActive");

-- Add channel column to FollowUpJob for channel-aware follow-ups
ALTER TABLE "FollowUpJob" ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'SMS';
