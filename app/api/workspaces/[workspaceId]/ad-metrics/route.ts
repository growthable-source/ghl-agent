/**
 * GET /api/workspaces/[workspaceId]/ad-metrics?days=30
 *
 * Workspace-scoped rollup of stored ad metrics for the dashboard.
 * Returns:
 *   - per-account daily rows (for charts)
 *   - per-account totals over the window
 *   - workspace-wide totals
 *
 * Reads only the persisted DB tables (AdDailyMetric, GoogleAdMetric) —
 * never hits the upstream APIs. The cron does the fetching; the
 * dashboard reads what's already there.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await ctx.params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const url = new URL(req.url)
  const days = Math.max(1, Math.min(180, parseInt(url.searchParams.get('days') ?? '30', 10) || 30))
  const since = new Date()
  since.setUTCDate(since.getUTCDate() - days)
  since.setUTCHours(0, 0, 0, 0)

  const [metaAccounts, googleAccounts] = await Promise.all([
    db.metaAdAccount.findMany({
      where: { workspaceId },
      select: { id: true, accountName: true, metaAccountId: true, isActive: true },
    }),
    db.googleAdAccount.findMany({
      where: { workspaceId },
      select: { id: true, accountName: true, googleCustomerId: true, isActive: true },
    }),
  ])

  const metaIds = metaAccounts.map((a) => a.id)
  const googleIds = googleAccounts.map((a) => a.id)

  const [metaDaily, googleDaily] = await Promise.all([
    metaIds.length > 0
      ? db.adDailyMetric.findMany({
          where: { accountId: { in: metaIds }, date: { gte: since } },
          select: {
            accountId: true,
            date: true,
            spend: true,
            leads: true,
            impressions: true,
            clicks: true,
            cpl: true,
            cpm: true,
            ctr: true,
            cpc: true,
          },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve([]),
    googleIds.length > 0
      ? db.googleAdMetric.findMany({
          where: { accountId: { in: googleIds }, date: { gte: since } },
          select: {
            accountId: true,
            date: true,
            campaignId: true,
            spend: true,
            impressions: true,
            clicks: true,
            conversions: true,
            conversionValue: true,
            ctr: true,
            cpc: true,
            cpm: true,
            costPerConversion: true,
            impressionShare: true,
          },
          orderBy: { date: 'asc' },
        })
      : Promise.resolve([]),
  ])

  // Roll up Google rows from per-campaign to per-account per-day so the
  // chart shape matches Meta's account-level grain.
  const googleAccountDaily = new Map<string, Map<string, { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number }>>()
  for (const r of googleDaily) {
    const day = r.date.toISOString().slice(0, 10)
    let perAccount = googleAccountDaily.get(r.accountId)
    if (!perAccount) { perAccount = new Map(); googleAccountDaily.set(r.accountId, perAccount) }
    const cur = perAccount.get(day) ?? { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 }
    cur.spend += Number(r.spend)
    cur.impressions += Number(r.impressions)
    cur.clicks += Number(r.clicks)
    cur.conversions += Number(r.conversions)
    cur.conversionValue += Number(r.conversionValue)
    perAccount.set(day, cur)
  }

  // Flatten Meta to the same shape so the UI can iterate uniformly.
  const accountSeries: Array<{
    accountId: string
    provider: 'meta' | 'google'
    accountName: string
    days: Array<{ date: string; spend: number; impressions: number; clicks: number; leadsOrConversions: number; ctr: number | null; cpl: number | null }>
    totals: { spend: number; impressions: number; clicks: number; leadsOrConversions: number; ctr: number | null; cpl: number | null }
  }> = []

  for (const acc of metaAccounts) {
    const days = metaDaily
      .filter((r) => r.accountId === acc.id)
      .map((r) => ({
        date: r.date.toISOString().slice(0, 10),
        spend: Number(r.spend),
        impressions: Number(r.impressions),
        clicks: r.clicks,
        leadsOrConversions: r.leads,
        ctr: r.ctr === null ? null : Number(r.ctr),
        cpl: r.cpl === null ? null : Number(r.cpl),
      }))
    accountSeries.push({
      accountId: acc.id,
      provider: 'meta',
      accountName: acc.accountName,
      days,
      totals: rollupTotals(days),
    })
  }

  for (const acc of googleAccounts) {
    const perDay = googleAccountDaily.get(acc.id) ?? new Map()
    const days = Array.from(perDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, t]) => ({
        date,
        spend: t.spend,
        impressions: t.impressions,
        clicks: t.clicks,
        leadsOrConversions: t.conversions,
        ctr: t.impressions > 0 ? t.clicks / t.impressions : null,
        cpl: t.conversions > 0 ? t.spend / t.conversions : null,
      }))
    accountSeries.push({
      accountId: acc.id,
      provider: 'google',
      accountName: acc.accountName,
      days,
      totals: rollupTotals(days),
    })
  }

  const workspaceTotals = rollupTotals(accountSeries.flatMap((a) => a.days))

  return NextResponse.json({
    days,
    since: since.toISOString(),
    workspaceTotals,
    accountSeries,
  })
}

function rollupTotals(rows: Array<{ spend: number; impressions: number; clicks: number; leadsOrConversions: number }>) {
  const totals = rows.reduce((acc, r) => {
    acc.spend += r.spend
    acc.impressions += r.impressions
    acc.clicks += r.clicks
    acc.leadsOrConversions += r.leadsOrConversions
    return acc
  }, { spend: 0, impressions: 0, clicks: 0, leadsOrConversions: 0 })
  return {
    ...totals,
    ctr: totals.impressions > 0 ? totals.clicks / totals.impressions : null,
    cpl: totals.leadsOrConversions > 0 ? totals.spend / totals.leadsOrConversions : null,
  }
}
