/**
 * GET /api/cron/sync-ad-metrics
 *
 * Daily metric sync. Iterates every active MetaAdAccount and
 * GoogleAdAccount across the workspace, fetches the last N days of
 * insights / report metrics, and upserts them into AdDailyMetric /
 * AdCreativeMetric / GoogleAdMetric.
 *
 * Idempotent — the upsert keys are (accountId, date) for account-level
 * Meta + (accountId, adId, date) for creative-level + (accountId,
 * campaignId, date) for Google. Re-running on the same day overwrites
 * the row so we always have the latest snapshot.
 *
 * The cron runs daily in vercel.json. It can also be hit on demand
 * (with the bearer secret) to backfill or recover from a failure.
 *
 * Per-account failures don't fail the whole run — we log them to
 * AdActivityLog with actionType='metric_sync_failed' so the operator
 * can see why a particular account is missing data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchAccountDailyMetrics, fetchCreativeDailyMetrics } from '@/lib/ad-meta-metrics'
import { fetchCampaignDailyMetrics } from '@/lib/ad-google-metrics'
import { refreshGoogleAdsAccessToken } from '@/lib/ad-google-client'

export const dynamic = 'force-dynamic'
// Cron job — Vercel kills functions after the route's maxDuration.
// Default 10s isn't enough when iterating dozens of accounts. Bumped
// to 60s; if we ever exceed that, switch to per-account queue.
export const maxDuration = 60

const DAYS_BACK = 3

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const summary = {
    meta: { accounts: 0, dayRows: 0, adRows: 0, errors: [] as string[] },
    google: { accounts: 0, campaignRows: 0, errors: [] as string[] },
    elapsedMs: 0,
  }
  const start = Date.now()

  // ─── Meta ────────────────────────────────────────────────────────────
  const metaAccounts = await db.metaAdAccount.findMany({
    where: { isActive: true },
    select: { id: true, metaAccountId: true, accessToken: true, accountName: true },
  })
  for (const acc of metaAccounts) {
    summary.meta.accounts++
    try {
      const dailyRes = await fetchAccountDailyMetrics({
        metaAccountId: acc.metaAccountId,
        accessToken: acc.accessToken,
        daysBack: DAYS_BACK,
      })
      if (!dailyRes.ok) {
        summary.meta.errors.push(`meta:${acc.id} daily — ${dailyRes.error}`)
        await logSyncFailure({ metaAccountId: acc.id, kind: 'daily', reason: dailyRes.error })
      } else {
        for (const r of dailyRes.rows) {
          await db.adDailyMetric.upsert({
            where: { accountId_date: { accountId: acc.id, date: new Date(r.date) } },
            create: {
              accountId: acc.id,
              date: new Date(r.date),
              spend: r.spend,
              leads: r.leads,
              impressions: r.impressions,
              clicks: r.clicks,
              cpl: r.cpl ?? undefined,
              cpm: r.cpm ?? undefined,
              ctr: r.ctr ?? undefined,
              cpc: r.cpc ?? undefined,
            },
            update: {
              spend: r.spend,
              leads: r.leads,
              impressions: r.impressions,
              clicks: r.clicks,
              cpl: r.cpl ?? undefined,
              cpm: r.cpm ?? undefined,
              ctr: r.ctr ?? undefined,
              cpc: r.cpc ?? undefined,
            },
          })
          summary.meta.dayRows++
        }
      }

      const creativeRes = await fetchCreativeDailyMetrics({
        metaAccountId: acc.metaAccountId,
        accessToken: acc.accessToken,
        daysBack: DAYS_BACK,
      })
      if (!creativeRes.ok) {
        summary.meta.errors.push(`meta:${acc.id} creative — ${creativeRes.error}`)
        await logSyncFailure({ metaAccountId: acc.id, kind: 'creative', reason: creativeRes.error })
      } else {
        for (const r of creativeRes.rows) {
          await db.adCreativeMetric.upsert({
            where: { accountId_adId_date: { accountId: acc.id, adId: r.adId, date: new Date(r.date) } },
            create: {
              accountId: acc.id,
              adId: r.adId,
              adName: r.adName,
              date: new Date(r.date),
              spend: r.spend,
              impressions: r.impressions,
              clicks: r.clicks,
              leads: r.leads,
              ctr: r.ctr ?? undefined,
              cpl: r.cpl ?? undefined,
            },
            update: {
              adName: r.adName,
              spend: r.spend,
              impressions: r.impressions,
              clicks: r.clicks,
              leads: r.leads,
              ctr: r.ctr ?? undefined,
              cpl: r.cpl ?? undefined,
            },
          })
          summary.meta.adRows++
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.meta.errors.push(`meta:${acc.id} — ${msg}`)
      await logSyncFailure({ metaAccountId: acc.id, kind: 'unhandled', reason: msg })
    }
  }

  // ─── Google ──────────────────────────────────────────────────────────
  const developerToken = process.env.GOOGLE_DEVELOPER_TOKEN
  if (!developerToken) {
    summary.google.errors.push('GOOGLE_DEVELOPER_TOKEN not set — skipped Google sync entirely')
  } else {
    const googleAccounts = await db.googleAdAccount.findMany({
      where: { isActive: true },
      select: { id: true, googleCustomerId: true, refreshToken: true, accountName: true },
    })
    for (const acc of googleAccounts) {
      summary.google.accounts++
      try {
        const accessToken = await refreshGoogleAdsAccessToken(acc.refreshToken)
        const res = await fetchCampaignDailyMetrics({
          customerId: acc.googleCustomerId,
          accessToken,
          developerToken,
          daysBack: DAYS_BACK,
        })
        if (!res.ok) {
          summary.google.errors.push(`google:${acc.id} — ${res.error}`)
          await logSyncFailure({ googleAccountId: acc.id, kind: 'campaign', reason: res.error })
          continue
        }
        for (const r of res.rows) {
          // GoogleAdMetric uniqueness was not declared in the schema —
          // we use updateMany-then-create to dedupe instead of upsert.
          await db.googleAdMetric.deleteMany({
            where: { accountId: acc.id, date: new Date(r.date), campaignId: r.campaignId },
          })
          await db.googleAdMetric.create({
            data: {
              accountId: acc.id,
              date: new Date(r.date),
              campaignId: r.campaignId,
              spend: r.spend,
              impressions: r.impressions,
              clicks: r.clicks,
              conversions: r.conversions,
              conversionValue: r.conversionValue,
              ctr: r.ctr ?? undefined,
              cpc: r.cpc ?? undefined,
              cpm: r.cpm ?? undefined,
              costPerConversion: r.costPerConversion ?? undefined,
              impressionShare: r.impressionShare ?? undefined,
            },
          })
          summary.google.campaignRows++
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        summary.google.errors.push(`google:${acc.id} — ${msg}`)
        await logSyncFailure({ googleAccountId: acc.id, kind: 'unhandled', reason: msg })
      }
    }
  }

  summary.elapsedMs = Date.now() - start
  return NextResponse.json(summary)
}

async function logSyncFailure(p: {
  metaAccountId?: string
  googleAccountId?: string
  kind: string
  reason: string
}): Promise<void> {
  try {
    await db.adActivityLog.create({
      data: {
        metaAccountId: p.metaAccountId,
        googleAccountId: p.googleAccountId,
        actionType: 'metric_sync_failed',
        description: `Metric sync (${p.kind}) failed: ${p.reason.slice(0, 200)}`,
        performedBy: 'cron',
        details: { kind: p.kind, reason: p.reason } as object,
      },
    })
  } catch {
    // Logging failures shouldn't crash the cron itself.
  }
}
