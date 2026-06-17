import { NextRequest, NextResponse } from 'next/server'
import { drainSlackOutbox } from '@/lib/slack/outbox'
import { recordCronRun } from '@/lib/cron-heartbeat'

// Vercel cron triggers this every minute (configured in vercel.json). Drains
// queued widget→Slack messages; next-minute always picks up any backlog.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const isCron = req.headers.get('x-vercel-cron-signature') !== null
  const secret = req.headers.get('authorization')?.replace(/^Bearer /, '')
  const allowed = isCron || (process.env.CRON_SECRET && secret === process.env.CRON_SECRET)
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await drainSlackOutbox({ limit: 100 })
  await recordCronRun('slack-outbox', true)
  return NextResponse.json({ ok: true })
}
