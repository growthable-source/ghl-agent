-- Add image-gen telemetry column to LandingPageBuild so the wizard
-- timeline can surface why a hero/OG image didn't appear (Replicate
-- auth, quota, content policy, model 404, etc.) instead of silently
-- shipping pages with no imagery.
--
-- Strictly additive; idempotent.

ALTER TABLE "LandingPageBuild" ADD COLUMN IF NOT EXISTS "imageGenReport" JSONB;

-- Mark this migration applied in _prisma_migrations so future Prisma
-- introspection / drift checks are clean. Skips gracefully if the
-- table doesn't exist yet (fresh DB scenario).
DO $$
DECLARE
  migs TEXT[] := ARRAY['20260506220000_build_image_gen_report'];
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
