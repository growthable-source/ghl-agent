-- ─── Per-agent knowledge scoping ────────────────────────────────────────
-- Restricts which KnowledgeDomain ids an agent retrieves from. Empty
-- array (default) = every domain in the workspace, identical to today's
-- behaviour. Populated = only those domain ids — lets operators run
-- one agent on "Product Support" and another on "Legal Docs" within
-- the same workspace without seeing each other's content.
--
-- Safe to re-run.

ALTER TABLE "Agent"
  ADD COLUMN IF NOT EXISTS "knowledgeDomainIds" TEXT[] NOT NULL DEFAULT '{}';
