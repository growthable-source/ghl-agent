-- Sentiment traffic light on live-chat conversations + conduct block on visitors.
ALTER TABLE "WidgetConversation" ADD COLUMN "sentiment" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN "sentimentReason" TEXT;
ALTER TABLE "WidgetConversation" ADD COLUMN "sentimentUpdatedAt" TIMESTAMP(3);

ALTER TABLE "WidgetVisitor" ADD COLUMN "blockedAt" TIMESTAMP(3);
ALTER TABLE "WidgetVisitor" ADD COLUMN "blockReason" TEXT;
ALTER TABLE "WidgetVisitor" ADD COLUMN "blockedByEmail" TEXT;

-- Fast lookup of red/amber conversations for the portal.
CREATE INDEX "WidgetConversation_sentiment_idx" ON "WidgetConversation"("sentiment");
