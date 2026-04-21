import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshAccessToken } from '@/lib/token-store'

export const dynamic = 'force-dynamic'

/**
 * Proactive GHL token refresh cron.
 *
 * Runs every 30 minutes via Vercel Cron. Finds every Location whose
 * access token is within ~1 hour of expiry and refreshes it before a
 * customer webhook hits an expired token.
 *
 * Why this matters: locations that don't receive any traffic for a while
 * (quiet weekend, test workspace, etc.) could otherwise sit on an expired
 * token until the NEXT webhook arrives — and that first webhook pays the
 * refresh latency on the critical path. If the refresh_token has itself
 * expired (rare but happens with long idle periods) the customer sees an
 * outage instead of us catching it here and notifying.
 *
 * Secured by CRON_SECRET — matches the pattern of our other crons.
 */

// Refresh if the token expires within this window. Well under the typical
// 24-hour refresh-token lifetime GHL returns, so we have plenty of slack.
const REFRESH_WINDOW_MS = 60 * 60 * 1000   // 1 hour

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Find locations whose token is already expired OR expires within the
  // next hour. Skip placeholder locations (crmProvider='none') — they
  // have dummy tokens and there's nothing to refresh.
  const cutoff = new Date(Date.now() + REFRESH_WINDOW_MS)
  const candidates = await db.location.findMany({
    where: {
      expiresAt: { lt: cutoff },
      crmProvider: { not: 'none' },
    },
    select: { id: true, expiresAt: true, userType: true },
    take: 200,   // bound per-tick so a deploy-wide expiry storm doesn't stall
  })

  let refreshed = 0
  let failed = 0
  const failures: Array<{ id: string; reason: string }> = []

  for (const loc of candidates) {
    try {
      const result = await refreshAccessToken(loc.id)
      if (result) {
        refreshed++
      } else {
        failed++
        failures.push({ id: loc.id, reason: 'refresh returned null — likely invalid_grant, user must reconnect' })
      }
    } catch (err: any) {
      failed++
      failures.push({ id: loc.id, reason: err?.message ?? 'unknown' })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: candidates.length,
    refreshed,
    failed,
    // Only expose the IDs of failures so an operator can go reconnect
    // specific workspaces. Don't log reasons per-ID here — they're
    // already in the Vercel log from the refresh function.
    failures: failures.slice(0, 25),
  })
}
