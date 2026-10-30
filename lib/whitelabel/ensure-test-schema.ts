/**
 * Test builds only: make sure the database has the white-label team
 * sign-in schema (migrations 20261023120000_whitelabel_team_sign_in and
 * 20261027120000_whitelabel_button_text_color).
 *
 * Why this exists: Vercel preview builds run the migration step, but on
 * this project it does not reliably reach the database the preview
 * serves from, and the people testing preview builds can't run database
 * commands. Without the new columns every page that reads a full
 * Workspace row errors ("Something went wrong"). So a non-production
 * server, on start-up (instrumentation.ts), adds whatever is missing.
 *
 * Safe by construction:
 *   - Never runs in production (previewModeAllowed).
 *   - Only ADDS (nullable columns, a new table, its indexes and foreign
 *     key) — never alters or drops anything.
 *   - Checks first and does nothing when everything exists, so normal
 *     start-ups take no table locks.
 *   - Every statement is IF NOT EXISTS, and the migration itself is
 *     written the same way, so the real `prisma migrate deploy` still
 *     succeeds afterwards on a database this already touched.
 *   - Any failure is logged and swallowed; the server starts regardless.
 */

import { db } from '@/lib/db'
import { previewModeAllowed } from './preview-token'

const STATEMENTS = [
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelLogoUrl" TEXT`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelAccentColor" TEXT`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelLoginHeading" TEXT`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelLoginMessage" TEXT`,
  `ALTER TABLE "Workspace" ADD COLUMN IF NOT EXISTS "whitelabelButtonTextColor" TEXT`,
  `CREATE TABLE IF NOT EXISTS "WorkspaceLoginCode" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkspaceLoginCode_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "WorkspaceLoginCode_workspaceId_email_createdAt_idx" ON "WorkspaceLoginCode"("workspaceId", "email", "createdAt")`,
  `CREATE INDEX IF NOT EXISTS "WorkspaceLoginCode_ip_createdAt_idx" ON "WorkspaceLoginCode"("ip", "createdAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WorkspaceLoginCode_workspaceId_fkey') THEN
      ALTER TABLE "WorkspaceLoginCode" ADD CONSTRAINT "WorkspaceLoginCode_workspaceId_fkey"
        FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
]

async function schemaPresent(): Promise<boolean> {
  const rows = await db.$queryRawUnsafe<{ n: bigint | number }[]>(
    `SELECT
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = current_schema() AND table_name = 'Workspace'
           AND column_name IN ('whitelabelLogoUrl','whitelabelAccentColor','whitelabelLoginHeading','whitelabelLoginMessage','whitelabelButtonTextColor'))
     + (SELECT count(*) FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = 'WorkspaceLoginCode') AS n`,
  )
  return Number(rows[0]?.n ?? 0) === 6
}

export async function ensureWhitelabelTestSchema(): Promise<void> {
  if (!previewModeAllowed({ VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV })) return
  try {
    if (await schemaPresent()) return
    for (const sql of STATEMENTS) await db.$executeRawUnsafe(sql)
    console.log('[whitelabel] test build: added the missing white-label sign-in schema')
  } catch (err) {
    console.error('[whitelabel] test build: could not add the white-label sign-in schema', err)
  }
}
