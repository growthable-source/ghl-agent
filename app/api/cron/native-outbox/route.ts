import { NextRequest, NextResponse } from 'next/server'
import { drainNativeOutbox } from '@/lib/native-outbox'
import { recordCronRun } from '@/lib/cron-heartbeat'

// Vercel cron triggers this every minute (configured in vercel.json). The
// function pulls a small batch (50 messages) per run, which is plenty for
// realistic SMS/email volume — Twilio + Resend both rate-limit anyway, and
// queueing a backlog is fine because next-minute always picks up where this
// left off.
export const maxDuration = 60

export async function GET(req: NextRequest) {
  // Vercel sets x-vercel-cron-signature on cron-triggered invocations; the
  // CRON_SECRET path covers manual + non-Vercel hosting. Either is fine.
  const isCron = req.headers.get('x-vercel-cron-signature') !== null
  const secret = req.headers.get('authorization')?.replace(/^Bearer /, '')
  const allowed = isCron || (process.env.CRON_SECRET && secret === process.env.CRON_SECRET)
  if (!allowed) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await drainNativeOutbox({ limit: 50 })
  await recordCronRun('native-outbox', true)
  return NextResponse.json(result)
}
