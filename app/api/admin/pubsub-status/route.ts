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
import { getPubsubStatus } from '@/lib/widget-pubsub'

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
  if (provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  return NextResponse.json(getPubsubStatus())
}
