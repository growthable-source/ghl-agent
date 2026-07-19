-- Per-source knowledge usage triggers ("use this knowledge when …").
-- Map of knowledge source id (KnowledgeDomain id or KnowledgeCollection id)
-- → natural-language condition. Sources without an entry always apply.
-- Run by hand in production (Ryan), matching the manual-SQL workflow.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "knowledgeConditions" JSONB NOT NULL DEFAULT '{}';
