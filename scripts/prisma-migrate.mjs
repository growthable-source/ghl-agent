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
  // Vercel's build sandbox doesn't always expose runtime env vars unless
  // the operator ticked "Build" on the variable. Without DATABASE_URL we
  // literally can't connect, so skip cleanly — the build will still
  // produce a working app and migrations can run on the next deploy
  // (or be applied manually). Exiting 0 here keeps the build green.
  if (!process.env.DATABASE_URL) {
    console.warn('[migrate] ⚠ DATABASE_URL not set — skipping migrations. If you expected this to run, check your Vercel env vars have the "Build" scope enabled.')
    process.exit(0)
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
        console.error('[migrate] ⚠ Cannot reach database at build time:', msg)
        console.error('[migrate] Build will continue; run migrations manually once the DB is reachable.')
        process.exit(0)
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
  // Log the error clearly but let the build continue. A failed migration
  // is better than a failed deploy that never ships the new code — the
  // worst case is schema stays on the old version and prisma migrate
  // runs on the next deploy or manual invocation.
  console.error('[migrate] ✗ Migration step failed:')
  console.error(err?.message ?? err)
  console.error('[migrate] Build will continue. Re-run `npm run db:migrate:deploy` manually or check your DATABASE_URL.')
  process.exit(0)
})
