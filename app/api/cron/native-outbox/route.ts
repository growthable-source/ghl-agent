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

  // Piggyback: re-send ticket reply emails whose Resend send failed
  // transiently (429 / 5xx / network). Same "outbound delivery" concern,
  // same every-minute cadence — not worth its own cron slot.
  let ticketEmails: { scanned: number; sent: number; gaveUp: number } | { error: string }
  try {
    const { retryFailedTicketEmails } = await import('@/lib/ticket-email-retry')
    ticketEmails = await retryFailedTicketEmails()
  } catch (err: any) {
    console.warn('[native-outbox] ticket-email retry failed:', err?.message)
    ticketEmails = { error: err?.message ?? 'unknown' }
  }

  await recordCronRun('native-outbox', true)
  return NextResponse.json({ ...result, ticketEmails })
}
