-- Simulations: synthetic conversations between a persona-Claude and the
-- real agent, used to generate training signal without waiting for real
-- inbounds. After each simulation completes, the transcript is reviewed
-- by the meta-Claude auto-reviewer which proposes PlatformLearnings.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS "Simulation" (
  "id"                     TEXT NOT NULL,
  "agentId"                TEXT NOT NULL,
  "workspaceId"            TEXT,
  "personaContext"         TEXT NOT NULL,
  "channel"                TEXT NOT NULL,
  "style"                  TEXT NOT NULL,
  "goal"                   TEXT,
  "maxTurns"               INTEGER NOT NULL DEFAULT 10,
  "status"                 TEXT NOT NULL DEFAULT 'queued',
  "startedAt"              TIMESTAMP(3),
  "completedAt"            TIMESTAMP(3),
  "errorMessage"           TEXT,
  "turnCount"              INTEGER NOT NULL DEFAULT 0,
  "transcript"             JSONB NOT NULL DEFAULT '[]'::jsonb,
  "reviewId"               TEXT,
  "proposedLearningsCount" INTEGER NOT NULL DEFAULT 0,
  "createdByType"          TEXT NOT NULL,
  "createdByEmail"         TEXT,
  "swarmId"                TEXT,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Simulation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "SimulationSwarm" (
  "id"              TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "agentIds"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "personaProfiles" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "runsPerAgent"    INTEGER NOT NULL DEFAULT 1,
  "status"          TEXT NOT NULL DEFAULT 'queued',
  "createdByEmail"  TEXT NOT NULL,
  "totalPlanned"    INTEGER NOT NULL,
  "totalComplete"   INTEGER NOT NULL DEFAULT 0,
  "totalFailed"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SimulationSwarm_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Simulation"
    ADD CONSTRAINT "Simulation_agentId_fkey"
    FOREIGN KEY ("agentId") REFERENCES "Agent"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Simulation"
    ADD CONSTRAINT "Simulation_swarmId_fkey"
    FOREIGN KEY ("swarmId") REFERENCES "SimulationSwarm"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Simulation_agentId_createdAt_idx"
  ON "Simulation"("agentId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "Simulation_workspaceId_status_idx"
  ON "Simulation"("workspaceId", "status");
CREATE INDEX IF NOT EXISTS "Simulation_status_createdAt_idx"
  ON "Simulation"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "Simulation_swarmId_idx"
  ON "Simulation"("swarmId");
CREATE INDEX IF NOT EXISTS "SimulationSwarm_status_createdAt_idx"
  ON "SimulationSwarm"("status", "createdAt");

-- Mark applied.
DO $$
DECLARE
  migs TEXT[] := ARRAY['20260422215217_simulations'];
  m TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = '_prisma_migrations') THEN
    RAISE NOTICE '_prisma_migrations missing — skipping. Run `npx prisma migrate resolve --applied <name>` locally instead.';
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
