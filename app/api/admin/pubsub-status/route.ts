/**
 * GET /api/admin/pubsub-status?secret=<CRON_SECRET>
 *
 * Surfaces the cross-instance pubsub state so we can verify whether
 * realtime delivery is healthy or silently degraded.
 *
 * Why this exists: when `state` reports 'unavailable', SSE broadcasts
 * from one Vercel function don't reach subscribers on a different
 * function — which is the root cause of the entire QA cluster around
 * "messages don't show up until I refresh." Without observability the
 * symptom looks like a per-feature bug; with this endpoint the
 * infrastructure cause is obvious in one HTTP call.
 *
 * Returns the connection-string host (NOT credentials), the current
 * state, and an actionable hint when degraded.
 *
 * Auth: ?secret=<CRON_SECRET>. Same pattern as other /admin endpoints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getPubsubStatus, subscribe, publish } from '@/lib/widget-pubsub'

/**
 * Round-trip diagnostic: subscribes to a synthetic channel, publishes
 * a test message, waits for it to come back via the LISTEN connection.
 *
 * Why round-trip and not just connect-check: the pubsub module has TWO
 * independent halves. LISTEN goes through the Session pooler; publish
 * goes through Prisma. A previous version of the code worked LISTEN
 * correctly but had a syntax error on publish (NOTIFY doesn't accept
 * $-params), and the connect-only diagnostic happily reported
 * 'available' even though no message ever crossed. The round-trip
 * probe exercises both halves end-to-end so silent-publish regressions
 * surface here instead of in QA.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // Each call uses a fresh channel id so concurrent probes don't see
  // each other's messages — would otherwise produce flaky "received
  // someone else's payload" matches.
  const channel = `__pubsub_status_probe_${Math.random().toString(36).slice(2)}__`
  const nonce = Math.random().toString(36).slice(2)
  const sentinel = { type: 'pubsub_probe', nonce }

  let received = false
  let receivedAtMs = 0
  const startMs = Date.now()
  const probe = await subscribe(channel, msg => {
    const m = msg as { type?: string; nonce?: string }
    if (m?.type === 'pubsub_probe' && m.nonce === nonce) {
      received = true
      receivedAtMs = Date.now() - startMs
    }
  })

  // Brief grace for tryGetSharedClient() to land before we publish.
  await new Promise(r => setTimeout(r, 300))
  await publish(channel, sentinel)
  // Wait up to 1.5s for the round-trip to come back through LISTEN.
  for (let i = 0; i < 15; i++) {
    if (received) break
    await new Promise(r => setTimeout(r, 100))
  }
  const status = getPubsubStatus()
  await probe.close()

  return NextResponse.json({
    ...status,
    roundTrip: {
      received,
      latencyMs: received ? receivedAtMs : null,
      // When NOT received, the likely cause is publish failing (the
      // bug that was hiding behind a green LISTEN check before this
      // diagnostic was added). Check Vercel logs for
      // '[widget-pubsub] NOTIFY failed:' to confirm.
      hint: received
        ? 'Round-trip OK. LISTEN + publish both healthy.'
        : 'Round-trip FAILED. LISTEN is up but publish isn\'t delivering. Check Vercel logs for [widget-pubsub] NOTIFY failed.',
    },
  })
}
