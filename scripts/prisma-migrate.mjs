#!/usr/bin/env node
/**
 * Vercel-build wrapper for Prisma migrations.
 *
 * Uses raw pg (NOT @prisma/client) for the precheck queries — Prisma 7
 * requires a driver-adapter on construction (`new PrismaClient({ adapter })`)
 * and the script doesn't need Prisma's query layer for SELECTs against
 * `_prisma_migrations`. Keeping it on raw pg also means a busted Prisma
 * client install can't break the migrate step.
 *
 * Flow:
 *   1. Probe `_prisma_migrations` with raw pg.
 *   2. If the table doesn't exist, mark every migration in the
 *      filesystem as applied (one-time baseline).
 *   3. Diff filesystem vs `_prisma_migrations`. If everything is
 *      already applied, skip `npx prisma migrate deploy` entirely —
 *      avoids transient prisma-side failures (drift checks, checksum
 *      mismatches) when migrations were applied out-of-band via SQL.
 *   4. Otherwise call `npx prisma migrate deploy`.
 *
 * Failure modes that fail the build (exit 1):
 *   - DATABASE_URL/POSTGRES_PRISMA_URL/POSTGRES_URL all unset
 *   - Cannot reach DB at build time
 *   - prisma migrate deploy fails (when it actually had work to do)
 *
 * Override env vars:
 *   PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true → exit 0 if DB unreachable
 *   PRISMA_MIGRATE_FAIL_OPEN=true            → exit 0 even if migrate fails
 */

import { execSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = 'prisma/migrations'

function pickConnectionString() {
  return (
    process.env.POSTGRES_PRISMA_URL ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL ??
    null
  )
}

async function main() {
  const connectionString = pickConnectionString()

  if (!connectionString) {
    if (process.env.PRISMA_MIGRATE_SKIP_IF_UNREACHABLE === 'true') {
      console.warn('[migrate] ⚠ No DB URL set; PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true → exiting 0.')
      process.exit(0)
    }
    console.error('[migrate] ✗ FATAL: DATABASE_URL / POSTGRES_PRISMA_URL / POSTGRES_URL all unset.')
    console.error('[migrate]   On Vercel, tick the "Build" scope on the variable in Project → Settings → Environment Variables.')
    console.error('[migrate]   To intentionally skip, set PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true.')
    process.exit(1)
  }

  const pool = new pg.Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Cap at 1 connection — we make a couple of one-off queries then exit.
    max: 1,
    connectionTimeoutMillis: 15_000,
  })

  let hasState = false
  try {
    await pool.query(`SELECT 1 FROM "_prisma_migrations" LIMIT 1`)
    hasState = true
  } catch (err) {
    const msg = String(err?.message ?? err)
    const isMissingTable = /relation .*"_prisma_migrations".* does not exist|undefined_table|42P01/i.test(msg)
    const isConnection = /ECONNREFUSED|ENOTFOUND|connect\s+timeout|getaddrinfo|EHOSTUNREACH|connection terminated/i.test(msg)
    if (isConnection) {
      if (process.env.PRISMA_MIGRATE_SKIP_IF_UNREACHABLE === 'true') {
        console.warn('[migrate] ⚠ Cannot reach DB; PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true → exiting 0.', msg)
        await pool.end().catch(() => {})
        process.exit(0)
      }
      console.error('[migrate] ✗ FATAL: Cannot reach database at build time:', msg)
      console.error('[migrate]   To intentionally skip, set PRISMA_MIGRATE_SKIP_IF_UNREACHABLE=true.')
      await pool.end().catch(() => {})
      process.exit(1)
    }
    if (!isMissingTable) {
      // Re-throw anything that isn't a known "table doesn't exist yet"
      // — there's nothing graceful we can do with an unexpected error.
      await pool.end().catch(() => {})
      throw err
    }
    hasState = false
  }

  if (!hasState) {
    console.log('[migrate] First run — initialising Prisma migration state against existing schema.')
    const names = readdirSync(MIGRATIONS_DIR)
      .filter(n => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
      .sort()
    console.log(`[migrate] Marking ${names.length} existing migration(s) as applied:`)
    for (const name of names) {
      console.log(`[migrate]   • ${name}`)
      execSync(`npx prisma migrate resolve --applied "${name}"`, { stdio: 'inherit' })
    }
  }

  // Fast-path skip when DB is in sync. Avoids the prisma-side migrate
  // deploy call (and its drift / checksum checks) when there's nothing
  // to actually deploy — typical state after an out-of-band manual SQL
  // apply.
  const dirNames = readdirSync(MIGRATIONS_DIR)
    .filter(n => statSync(join(MIGRATIONS_DIR, n)).isDirectory())
  let appliedRows
  try {
    appliedRows = (await pool.query(
      `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    )).rows
  } catch (err) {
    appliedRows = []
    console.warn('[migrate] ⚠ Could not list applied migrations:', err?.message ?? err)
  }
  const appliedSet = new Set(appliedRows.map(r => r.migration_name))
  const pending = dirNames.filter(n => !appliedSet.has(n))

  await pool.end().catch(() => {})

  if (pending.length === 0) {
    console.log(`[migrate] ✓ All ${dirNames.length} migration(s) already applied — skipping migrate deploy.`)
    return
  }

  console.log(`[migrate] ${pending.length} pending migration(s): ${pending.join(', ')}`)
  console.log('[migrate] Running prisma migrate deploy…')
  execSync('npx prisma migrate deploy', { stdio: 'inherit' })
  console.log('[migrate] ✓ Done.')
}

main().catch(err => {
  console.error('[migrate] ✗ Migration step failed:')
  console.error(err?.message ?? err)
  if (process.env.PRISMA_MIGRATE_FAIL_OPEN === 'true') {
    console.error('[migrate] PRISMA_MIGRATE_FAIL_OPEN=true → exiting 0 anyway. Be careful.')
    process.exit(0)
  }
  console.error('[migrate] Failing the build. Run `npm run db:migrate:deploy` from a machine that can reach the DB, or set PRISMA_MIGRATE_FAIL_OPEN=true to deploy anyway.')
  process.exit(1)
})
