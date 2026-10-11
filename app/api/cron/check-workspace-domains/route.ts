import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshWorkspaceDomain } from '@/lib/domains/workspace-domain'
import { isVercelDomainsConfigured } from '@/lib/domains/vercel'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// 50 rows x up to 3 Vercel calls each — leave headroom over the 10s default.
export const maxDuration = 60

/**
 * Keeps white-label domain status honest:
 *   - 'pending' rows are polled so customers who add the CNAME and walk away
 *     go 'active' without clicking Re-check. refreshWorkspaceDomain flips a
 *     row that never resolves to 'error' after 7 days, which ends polling.
 *   - 'active' rows are re-verified at most daily, so a removed/broken CNAME
 *     demotes the domain instead of silently serving a dead host.
 *   - Locked workspaces are skipped entirely (no Vercel calls).
 * Bounded per run.
 *
 * Secured by CRON_SECRET (query `secret` or Bearer header).
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!isVercelDomainsConfigured()) return NextResponse.json({ ok: true, skipped: 'vercel not configured' })

  const dayAgo = new Date(Date.now() - 86_400_000)
  const rows = await db.workspaceDomain.findMany({
    where: {
      workspace: { whitelabelUnlocked: true },
      OR: [
        { status: 'pending' },
        { status: 'active', OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: dayAgo } }] },
      ],
    },
    orderBy: { lastCheckedAt: 'asc' },
    take: 50,
    select: { workspaceId: true },
  })
  let activated = 0
  for (const r of rows) {
    const v = await refreshWorkspaceDomain(r.workspaceId)
    if (v?.status === 'active') activated++
  }
  return NextResponse.json({ ok: true, checked: rows.length, activated })
}
