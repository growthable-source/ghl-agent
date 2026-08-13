import { NextRequest, NextResponse } from 'next/server'
import { checkFleetHealth } from '@/lib/fleet-health'
import { dispatchFleetAlert } from '@/lib/fleet-alert'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * Every 5 minutes: is the AI still answering customers?
 *
 * Exists because a 32-hour total outage (2026-08-11 → 08-13) was detected by
 * a colleague posting screenshots in Slack. Every technical signal needed to
 * catch it inside 15 minutes was already in the database; nothing was reading
 * them. This does.
 *
 * Fast and read-only — a few counts — so the default function ceiling is
 * ample. Note middleware 204s /api/cron/* on the widget runtime, so this
 * runs once from the dashboard project even though both deploy this repo.
 */
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const isCron = req.headers.get('x-vercel-cron-signature') !== null
  const secret = req.headers.get('authorization')?.replace(/^Bearer /, '')
  const allowed = isCron || (process.env.CRON_SECRET && secret === process.env.CRON_SECRET)
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const health = await checkFleetHealth()

  // Alerting must never take the check down: if paging fails we still want
  // the status in the response and the heartbeat recorded, so /api/admin/
  // cron-health does not also go dark.
  let alert = { alerted: false, reason: 'not attempted' }
  try {
    alert = await dispatchFleetAlert(health)
  } catch (err) {
    console.error('[cron/fleet-health] alert dispatch failed:', err instanceof Error ? err.message : err)
  }

  if (health.status !== 'ok') {
    console.error(`[cron/fleet-health] ${health.status.toUpperCase()}: ${health.headline}`)
  }

  await recordCronRun('fleet-health', true)
  return NextResponse.json({ ...health, alert })
}
