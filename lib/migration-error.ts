/**
 * Helpers for detecting and responding to "the schema knows about this
 * column/table but the database doesn't" errors.
 *
 * This pattern bites every time we ship a Prisma schema change ahead of
 * the matching SQL migration. Without these helpers, mutations in new
 * features silently 500 and the UI swallows the error, making the
 * feature look broken with no signal as to why.
 *
 * Usage:
 *   try {
 *     await db.someModel.create({ data })
 *   } catch (err) {
 *     if (isMissingColumn(err)) return migrationPendingResponse('Feature X', 'manual_x.sql')
 *     throw err
 *   }
 */

import { NextResponse } from 'next/server'

export function isMissingColumn(err: any): boolean {
  if (!err) return false
  // Prisma error codes:
  //   P2021 — table does not exist
  //   P2022 — column does not exist
  if (err.code === 'P2022' || err.code === 'P2021') return true
  const msg = String(err.message ?? '')
  return /column .* does not exist/i.test(msg)
    || /relation .* does not exist/i.test(msg)
    || /no such (table|column)/i.test(msg)
}

export function migrationPendingResponse(featureName: string, sqlFile: string) {
  return NextResponse.json({
    error: `${featureName} needs a database migration first — run prisma/migrations-legacy/${sqlFile} in Supabase, then try again.`,
    code: 'MIGRATION_PENDING',
    sqlFile,
  }, { status: 503 })
}
