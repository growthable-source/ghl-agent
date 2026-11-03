import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { refreshWorkspaceDomain } from '@/lib/domains/workspace-domain'
import { isVercelDomainsConfigured } from '@/lib/domains/vercel'
import { refreshSendingDomain } from '@/lib/domains/sending-domain'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Up to 50 rows, 5 at a time, each up to 3 Vercel calls.
export const maxDuration = 300

/**
 * Keeps white-label domain status honest:
 *   - 'pending' rows are polled so customers who add the CNAME and walk away
 *     go 'active' without clicking Re-check. A row that never resolves is
 *     marked 'error' after 7 days (from pendingSince) and from then on is
 *     polled daily, so it still recovers when the customer fixes DNS.
 *   - 'active' rows are re-verified at most daily, so a removed/broken CNAME
 *     demotes the domain instead of silently serving a dead host.
 *   - Locked workspaces are skipped entirely (no Vercel calls).
 *   - White-label email sending domains (lib/domains/sending-domain.ts)
 *     get the same treatment against Resend: unverified ones are
 *     re-checked every run, verified ones at most daily.
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

  const dayAgo = new Date(Date.now() - 86_400_000)
  const sending = await checkSendingDomains(dayAgo)

  if (!isVercelDomainsConfigured()) return NextResponse.json({ ok: true, skipped: 'vercel not configured', sending })

  const rows = await db.workspaceDomain.findMany({
    where: {
      workspace: { whitelabelUnlocked: true },
      OR: [
        { status: 'pending' },
        { status: { in: ['active', 'error'] }, OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: dayAgo } }] },
      ],
    },
    orderBy: { lastCheckedAt: 'asc' },
    take: 50,
    select: { workspaceId: true },
  })
  let activated = 0
  const CONCURRENCY = 5
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const results = await Promise.all(rows.slice(i, i + CONCURRENCY).map(r => refreshWorkspaceDomain(r.workspaceId)))
    activated += results.filter(v => v?.status === 'active').length
  }
  return NextResponse.json({ ok: true, checked: rows.length, activated, sending })
}

async function checkSendingDomains(dayAgo: Date) {
  if (!process.env.RESEND_API_KEY) return { skipped: 'resend not configured' }
  const rows = await db.workspaceSendingDomain.findMany({
    where: {
      workspace: { whitelabelUnlocked: true },
      OR: [
        { status: { not: 'verified' } },
        { status: 'verified', OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: dayAgo } }] },
      ],
    },
    orderBy: { lastCheckedAt: 'asc' },
    take: 50,
    select: { workspaceId: true },
  }).catch(() => []) // table not migrated yet
  let verified = 0
  for (let i = 0; i < rows.length; i += 5) {
    const results = await Promise.all(rows.slice(i, i + 5).map(r => refreshSendingDomain(r.workspaceId)))
    verified += results.filter(v => v?.status === 'verified').length
  }
  return { checked: rows.length, verified }
}
