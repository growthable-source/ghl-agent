import { NextRequest, NextResponse } from 'next/server'
import { processModelRetries } from '@/lib/model-retry'
import { recordCronRun } from '@/lib/cron-heartbeat'

// Vercel cron triggers this every minute (configured in vercel.json). It
// replays inbounds that went unanswered because the model provider was
// transiently unavailable, rebuilding the live prompt and re-running the
// agent (which sends through the CRM adapter). A small batch per run is
// plenty — next-minute picks up where this left off — and each agent run can
// take seconds, so the function gets the full 300s ceiling like the inbound
// webhook.
export const maxDuration = 300

export async function GET(req: NextRequest) {
  const isCron = req.headers.get('x-vercel-cron-signature') !== null
  const secret = req.headers.get('authorization')?.replace(/^Bearer /, '')
  const allowed = isCron || (process.env.CRON_SECRET && secret === process.env.CRON_SECRET)
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await processModelRetries(25)
  await recordCronRun('retry-model-failures', !result.skippedMigration)
  return NextResponse.json(result)
}
