-- Approval-queue editing + brand-agent learning.
--
-- 1. TicketReplyDraft.editedBody: the reviewer's edited version of a reply,
--    captured when they change the wording before approving. NULL = approved
--    verbatim. Text sent = editedBody ?? body.
ALTER TABLE "TicketReplyDraft" ADD COLUMN "editedBody" TEXT;

-- 2. MinedQaPair gains a provenance discriminator so ticket-approval learnings
--    share the same human-gated review queue as conversation-mining pairs.
--    runId becomes nullable because ticket-approval pairs have no mining run.
ALTER TABLE "MinedQaPair" ALTER COLUMN "runId" DROP NOT NULL;
ALTER TABLE "MinedQaPair" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'mining';
ALTER TABLE "MinedQaPair" ADD COLUMN "sourceTicketId" TEXT;
ALTER TABLE "MinedQaPair" ADD COLUMN "knowledgeSourceId" TEXT;

CREATE INDEX "MinedQaPair_sourceTicketId_idx" ON "MinedQaPair"("sourceTicketId");
