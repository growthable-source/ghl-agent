#!/usr/bin/env node
/**
 * Run a hand-written SQL file against the app's database.
 *
 *   node scripts/run-sql.mjs prisma/sql/2026-07-22-unify-knowledge-collections.sql
 *   node scripts/run-sql.mjs --dry prisma/sql/whatever.sql   # run, print, ROLL BACK
 *
 * Exists because macOS has no psql by default and the connection string
 * lives in .env.local, not the shell. This is a MANUAL tool — nothing in
 * the build or deploy path calls it. Schema changes stay hand-applied,
 * which is the whole point of prisma/sql/*.
 *
 * --dry is the safe rehearsal: it executes the file inside a transaction
 * and rolls back, so you get real syntax + constraint validation against
 * real data without persisting anything. Use it first.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const args = process.argv.slice(2)
const dryRun = args.includes('--dry')
const file = args.find(a => !a.startsWith('--'))

if (!file) {
  console.error('Usage: node scripts/run-sql.mjs [--dry] <path-to.sql>')
  process.exit(1)
}

/** Read a key from .env.local / .env without pulling in a dotenv dep. */
function envValue(key) {
  for (const name of ['.env.local', '.env']) {
    let text
    try { text = readFileSync(resolve(process.cwd(), name), 'utf8') } catch { continue }
    const m = text.match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  }
  return process.env[key]
}

const connectionString =
  envValue('POSTGRES_PRISMA_URL') || envValue('POSTGRES_URL') || envValue('DATABASE_URL')

if (!connectionString) {
  console.error('No POSTGRES_PRISMA_URL / POSTGRES_URL / DATABASE_URL found in .env.local, .env or the environment.')
  process.exit(1)
}

const sql = readFileSync(resolve(process.cwd(), file), 'utf8')
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })

await client.connect()
console.log(`${dryRun ? 'DRY RUN' : 'APPLYING'}: ${file}`)

try {
  await client.query('BEGIN')
  await client.query(sql)
  if (dryRun) {
    await client.query('ROLLBACK')
    console.log('OK — statements executed cleanly, then ROLLED BACK. Database unchanged.')
  } else {
    await client.query('COMMIT')
    console.log('OK — committed.')
  }
} catch (err) {
  await client.query('ROLLBACK').catch(() => {})
  console.error('\nFAILED — rolled back, database unchanged.\n')
  console.error(err.message)
  if (err.position) console.error(`(at character ${err.position})`)
  process.exitCode = 1
} finally {
  await client.end()
}
