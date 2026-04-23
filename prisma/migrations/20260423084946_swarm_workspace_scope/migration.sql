-- Scope SimulationSwarm to a workspace so customer-created swarms
-- appear in their own dashboard without leaking into every admin-side
-- swarm list. Admin platform swarms leave workspaceId null.
-- Idempotent.

ALTER TABLE "SimulationSwarm"
  ADD COLUMN IF NOT EXISTS "workspaceId" TEXT;

CREATE INDEX IF NOT EXISTS "SimulationSwarm_workspaceId_createdAt_idx"
  ON "SimulationSwarm"("workspaceId", "createdAt" DESC);

-- Mark applied.
DO $$
DECLARE
  migs TEXT[] := ARRAY['20260423084946_swarm_workspace_scope'];
  m TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_prisma_migrations') THEN
    RAISE NOTICE '_prisma_migrations missing — skipping.';
    RETURN;
  END IF;
  FOREACH m IN ARRAY migs LOOP
    IF NOT EXISTS (SELECT 1 FROM "_prisma_migrations" WHERE migration_name = m) THEN
      INSERT INTO "_prisma_migrations"
        (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
      VALUES
        (gen_random_uuid()::text, 'manual', now(), m, NULL, NULL, now(), 1);
    END IF;
  END LOOP;
END $$;
