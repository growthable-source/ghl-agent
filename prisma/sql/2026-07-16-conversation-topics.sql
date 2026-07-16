-- ConversationTopic — the topic-telemetry table that never got a SQL file.
-- Run by hand in production (Ryan's workflow — nothing auto-runs).
--
-- Context: lib/agent/capture-topics.ts has been writing to this table
-- fire-and-forget since 2026-07-03, but the CREATE TABLE was never shipped,
-- so every capture silently no-ops in production. That's why the portal
-- Overview's "Top Topics" panel permanently shows "No topic matches yet".
-- Additive only — safe to run anytime. Rows appear forward-only from when
-- this is applied (capture re-runs retrieval per visitor turn).
--
-- Matches prisma/schema.prisma model ConversationTopic. No FK constraints —
-- the model declares none (plain telemetry, rows are disposable).

CREATE TABLE IF NOT EXISTS "ConversationTopic" (
    "id"             TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "widgetId"       TEXT NOT NULL,
    "workspaceId"    TEXT NOT NULL,
    "domainId"       TEXT,
    "topic"          TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationTopic_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ConversationTopic_conversationId_topic_key"
    ON "ConversationTopic"("conversationId", "topic");

CREATE INDEX IF NOT EXISTS "ConversationTopic_widgetId_createdAt_idx"
    ON "ConversationTopic"("widgetId", "createdAt");

CREATE INDEX IF NOT EXISTS "ConversationTopic_workspaceId_createdAt_idx"
    ON "ConversationTopic"("workspaceId", "createdAt");
