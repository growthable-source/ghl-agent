#!/usr/bin/env node
/**
 * Vercel-build wrapper for Prisma migrations.
 *
 * This solves the "DB already has schema but `_prisma_migrations` table
 * doesn't exist yet" problem that bites every team the first time they
 * switch to `prisma migrate`. Flow:
 *
 *   1. If `_prisma_migrations` doesn't exist, the DB was built by hand
 *      (our old manual_*.sql workflow). Create the table and mark every
 *      migration folder in prisma/migrations/ as `applied` so Prisma
 *      treats them as historical. This runs once.
 *   2. `npx prisma migrate deploy` — applies any NEW migrations in
 *      prisma/migrations/ that aren't yet in `_prisma_migrations`.
 *      On subsequent deploys this is the only thing that runs (the
 *      baseline step short-circuits).
 *
 * After the first deploy, adding schema changes is the standard
 * Prisma flow: `npx prisma migrate dev --name description` locally
 * creates a new migration folder, commit it, Vercel applies it on
 * the next deploy.
 *
 * Called from package.json build: "build": "node scripts/prisma-migrate.mjs && next build"
 */

import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

const MIGRATIONS_DIR = 'prisma/migrations'

async function main() {
  // Vercel's build sandbox only exposes env vars whose "Build" scope is
  // ticked. If DATABASE_URL is missing we can't migrate — and we MUST
  // NOT ship Prisma-client code that doesn't match the live schema.
  // Bias toward a loud failure here: a red Vercel deploy is far better
  // than a silent shipping of code with `column does not exist` errors
  // at runtime.
  //
  // Override for legitimate "we know the DB isn't reachable from build
  // and migrations will be applied separately" cases:
  //   PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_PRISMA_URL && !process.env.POSTGRES_URL) {
    if (process.env.PRISMA_MIGRATE_SKIP_IF_UNREACHABLE === 'true') {
      console.warn('[migrate] ⚠ DATABASE_URL unset; PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true → exiting 0.')
      process.exit(0)
    }
    console.error('[migrate] ✗ FATAL: DATABASE_URL / POSTGRES_PRISMA_URL / POSTGRES_URL all unset.')
    console.error('[migrate]   On Vercel, tick the "Build" scope on the variable in Project → Settings → Environment Variables.')
    console.error('[migrate]   To intentionally skip (e.g. the DB really isn\'t reachable from build), set PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true.')
    process.exit(1)
  }

  const db = new PrismaClient()
  try {
    // Probe for Prisma's internal state table. Any error (including
    // "relation does not exist") means first-time setup.
    let hasState = false
    try {
      await db.$queryRawUnsafe(`SELECT 1 FROM "_prisma_migrations" LIMIT 1`)
      hasState = true
    } catch (err) {
      // Differentiate "table doesn't exist" (expected) from "can't reach
      // the DB at all" (bad — fail fast so the operator sees it).
      const msg = String(err?.message ?? err)
      const isConnection = /P1001|P1002|ECONNREFUSED|ENOTFOUND|connect\s+timeout/i.test(msg)
      if (isConnection) {
        if (process.env.PRISMA_MIGRATE_SKIP_IF_UNREACHABLE === 'true') {
          console.warn('[migrate] ⚠ Cannot reach DB; PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true → exiting 0.', msg)
          process.exit(0)
        }
        console.error('[migrate] ✗ FATAL: Cannot reach database at build time:', msg)
        console.error('[migrate]   The Prisma client about to ship will produce runtime errors against the unmigrated schema.')
        console.error('[migrate]   To intentionally skip, set PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true.')
        process.exit(1)
      }
      hasState = false
    }

    if (!hasState) {
      console.log('[migrate] First run — initialising Prisma migration state against existing schema.')
      const names = readdirSync(MIGRATIONS_DIR)
        .filter(n => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
        .sort()   // timestamp-prefixed names sort chronologically
      console.log(`[migrate] Marking ${names.length} existing migration(s) as applied:`)
      for (const name of names) {
        console.log(`[migrate]   • ${name}`)
        execSync(`npx prisma migrate resolve --applied "${name}"`, { stdio: 'inherit' })
      }
    }

    console.log('[migrate] Running prisma migrate deploy…')
    execSync('npx prisma migrate deploy', { stdio: 'inherit' })
    console.log('[migrate] ✓ Done.')
  } finally {
    await db.$disconnect().catch(() => {})
  }
}

main().catch(err => {
  // Migration failures FAIL THE BUILD. Previous behaviour (exit 0) led
  // to silent prod outages where Prisma client shipped expecting columns
  // the live DB didn't have. A red Vercel deploy is the right signal.
  //
  // Override only if you know the migration is intentionally skipped:
  //   PRISMA_MIGRATE_FAIL_OPEN=true
  console.error('[migrate] ✗ Migration step failed:')
  console.error(err?.message ?? err)
  if (process.env.PRISMA_MIGRATE_FAIL_OPEN === 'true') {
    console.error('[migrate] PRISMA_MIGRATE_FAIL_OPEN=true → exiting 0 anyway. Be careful.')
    process.exit(0)
  }
  console.error('[migrate] Failing the build. Run `npm run db:migrate:deploy` from a machine that can reach the DB, or set PRISMA_MIGRATE_FAIL_OPEN=true to deploy anyway.')
  process.exit(1)
})
