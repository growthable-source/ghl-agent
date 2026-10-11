import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshWorkspaceDomain } from '@/lib/domains/workspace-domain'
import { isVercelDomainsConfigured } from '@/lib/domains/vercel'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * Polls Vercel for white-label domains still waiting on DNS so customers
 * who add the CNAME and walk away end up 'active' without clicking
 * Re-check. Only 'pending'/'error' rows are touched; active domains are
 * not re-polled here. Bounded per run.
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

  const rows = await db.workspaceDomain.findMany({
    where: { status: { not: 'active' } },
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
