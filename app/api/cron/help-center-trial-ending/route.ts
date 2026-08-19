import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-send'
import { getInstallUsage } from '@/lib/partner/install-usage'
import {
  customerTrialHtml, customerTrialSubject, customerTrialText,
  internalDigestHtml, internalDigestSubject, internalDigestText,
  type DigestRow, type CustomerTrialInput,
} from '@/lib/partner/trial-ending-emails'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const WINDOW_MS = 24 * 60 * 60 * 1000

// The Growthable dashboard origin (self-serve upgrade lives here),
// derived from the sync-push URL like the admin page's links.
function dashboardOrigin(): string | null {
  const url = process.env.HELP_CENTER_SYNC_URL
  if (!url) return null
  try { return new URL(url).origin } catch { return null }
}

/**
 * Daily: emails help-center customers whose trial ends in the next 24h
 * (marketing/upgrade), and sends the Growthable team a digest of the
 * same list so someone can reach out or unlock before they lapse.
 *
 * Idempotency:
 *  - Customer email: once per trial — guarded by
 *    metadata.trialEndingEmailedAt, which resets naturally if a new
 *    trial clock is ever set.
 *  - Internal digest: sent each run when there's ≥1 in the window
 *    (it's a daily snapshot, not per-customer), so re-running is fine.
 *
 * Secured by CRON_SECRET (Vercel adds `Authorization: Bearer` on cron).
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const windowEnd = new Date(now.getTime() + WINDOW_MS)

  // Ready installs whose workspace trial ends inside the window. Unlocked
  // installs have trialEndsAt = null (unlock clears it), so they're
  // excluded by construction.
  const installs = await db.partnerInstall.findMany({
    where: {
      status: 'ready',
      workspaceId: { not: null },
    },
    select: { id: true, businessName: true, externalEmail: true, widgetId: true, workspaceId: true, metadata: true },
  }).catch(() => [])

  const origin = dashboardOrigin()
  const xoveraOrigin = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/+$/, '')
  const salesUrl = process.env.SALES_CALL_URL || 'https://speakwith.growthable.io/sales'

  const digest: DigestRow[] = []
  let customerSent = 0

  for (const install of installs) {
    if (!install.workspaceId) continue
    const ws = await db.workspace.findUnique({
      where: { id: install.workspaceId },
      select: { plan: true, trialEndsAt: true },
    }).catch(() => null)
    if (!ws?.trialEndsAt) continue
    // Only paid-less trials that end inside the window.
    if (ws.plan !== 'trial') continue
    if (ws.trialEndsAt <= now || ws.trialEndsAt > windowEnd) continue

    const usage = await getInstallUsage(install.widgetId)
    const hoursRemaining = (ws.trialEndsAt.getTime() - now.getTime()) / 3_600_000

    digest.push({
      businessName: install.businessName,
      email: install.externalEmail,
      hoursRemaining,
      usage,
      adminUrl: `${xoveraOrigin}/admin/help-center?q=${encodeURIComponent(install.externalEmail)}`,
    })

    // Customer email — once per trial.
    const meta = (install.metadata ?? {}) as Record<string, unknown>
    if (meta.trialEndingEmailedAt) continue

    const input: CustomerTrialInput = {
      businessName: install.businessName,
      usage,
      hoursRemaining,
      dashboardOrigin: origin,
      salesUrl,
    }
    try {
      const id = await sendEmail({
        to: install.externalEmail,
        subject: customerTrialSubject(input),
        html: customerTrialHtml(input),
        text: customerTrialText(input),
        from: process.env.ONBOARDING_FROM_EMAIL || undefined,
        context: 'TrialEnding',
      })
      if (id !== null) {
        customerSent++
        await db.partnerInstall.update({
          where: { id: install.id },
          data: { metadata: { ...meta, trialEndingEmailedAt: now.toISOString() } as never },
        }).catch(() => {})
      }
    } catch (err) {
      console.warn(`[trial-ending] customer email failed for ${install.externalEmail}:`, err instanceof Error ? err.message : String(err))
    }
  }

  // Internal digest — one email to the team when there's anything to report.
  let digestSent = false
  if (digest.length > 0) {
    const recipients = (process.env.TRIAL_DIGEST_RECIPIENTS || 'ryan@growthable.io,dan@growthable.io')
      .split(',').map(s => s.trim()).filter(Boolean)
    try {
      await sendEmail({
        to: recipients,
        subject: internalDigestSubject(digest),
        html: internalDigestHtml(digest),
        text: internalDigestText(digest),
        from: process.env.ONBOARDING_FROM_EMAIL || undefined,
        context: 'TrialDigest',
      })
      digestSent = true
    } catch (err) {
      console.warn('[trial-ending] internal digest failed:', err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ ok: true, endingSoon: digest.length, customerSent, digestSent })
}
