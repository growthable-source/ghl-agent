/**
 * Scheduled portal email reports — data gathering + send. The HTML/text
 * templates live in report-email-render.ts (pure, previewable without a
 * DB). Sections: KPIs, estimated time saved, needs-attention, support
 * leaderboard (chats + tickets, week-over-week movement), AI insights,
 * top topics, chats per sub-account.
 *
 * Reused by: the hourly cron (Portal.reportFrequency), the admin
 * send-test button, and any future portal-side test send.
 */

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-send'
import { getChatsPerLocation } from '@/lib/portal/subaccount-stats'
import { getPortalAiInsights } from '@/lib/portal/ai-insights'
import { getSupportLeaderboard } from '@/lib/portal/leaderboard'
import {
  renderPortalReportHtml,
  renderPortalReportText,
  fmtTimeSaved,
  MINUTES_PER_HANDLED,
  type PortalReportData,
} from '@/lib/portal/report-email-render'

export async function gatherPortalReportData(portalId: string, windowDays: number): Promise<PortalReportData | null> {
  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: {
      name: true, slug: true, customDomain: true, logoUrl: true, primaryColor: true, isActive: true,
      portalBrands: { select: { brandId: true } },
    },
  })
  if (!portal || !portal.isActive) return null
  const brandIds = portal.portalBrands.map(b => b.brandId)
  if (brandIds.length === 0) return null

  const brands = await db.brand.findMany({ where: { id: { in: brandIds } }, select: { workspaceId: true } })
  const workspaceIds = Array.from(new Set(brands.map(b => b.workspaceId)))
  const widgets = await db.chatWidget.findMany({ where: { brandId: { in: brandIds } }, select: { id: true } })
  const widgetIds = widgets.map(w => w.id)
  if (widgetIds.length === 0) return null

  const appUrl = process.env.APP_URL || 'https://app.xovera.io'
  const portalUrl = portal.customDomain
    ? `https://${portal.customDomain}`
    : `${appUrl}/portal/login?p=${portal.slug}`

  const since = new Date(Date.now() - windowDays * 86_400_000)
  const base = { widgetId: { in: widgetIds } }

  const [total, aiHandled, csatAgg, openTickets, urgentTickets, highTickets, oldestTicket, waiting, oldestWaiting, topicGroups, locationChats, aiInsights, leaderboard] =
    await Promise.all([
      db.widgetConversation.count({ where: { ...base, createdAt: { gte: since } } }),
      // AI-handled = a real exchange happened and no human was ever assigned.
      db.widgetConversation.count({
        where: { ...base, createdAt: { gte: since }, assignedUserId: null, messages: { some: { role: 'agent' } } },
      }),
      db.widgetConversation.aggregate({
        where: { ...base, createdAt: { gte: since } },
        _avg: { csatRating: true }, _count: { csatRating: true },
      }),
      db.ticket.count({ where: { brandId: { in: brandIds }, status: { in: ['open', 'pending'] } } }).catch(() => 0),
      db.ticket.count({ where: { brandId: { in: brandIds }, status: { in: ['open', 'pending'] }, priority: 'urgent' } }).catch(() => 0),
      db.ticket.count({ where: { brandId: { in: brandIds }, status: { in: ['open', 'pending'] }, priority: 'high' } }).catch(() => 0),
      db.ticket.findFirst({
        where: { brandId: { in: brandIds }, status: { in: ['open', 'pending'] } },
        orderBy: { createdAt: 'asc' }, select: { createdAt: true },
      }).catch(() => null),
      db.widgetConversation.count({ where: { ...base, status: { in: ['handed_off'] } } }),
      db.widgetConversation.findFirst({
        where: { ...base, status: { in: ['handed_off'] } },
        orderBy: { lastMessageAt: 'asc' }, select: { lastMessageAt: true },
      }),
      db.conversationTopic.groupBy({
        by: ['topic'],
        where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
        _count: { _all: true },
        orderBy: { _count: { topic: 'desc' } },
        take: 5,
      }).catch(() => []),
      getChatsPerLocation(widgetIds, since),
      getPortalAiInsights(portalId, widgetIds, workspaceIds[0] ?? null),
      getSupportLeaderboard(widgetIds, brandIds, windowDays),
    ])

  const csat = csatAgg._avg.csatRating
  return {
    portalName: portal.name,
    logoUrl: portal.logoUrl,
    primaryColor: portal.primaryColor || '#e88b25',
    portalUrl,
    windowDays,
    totalConversations: total,
    aiHandled,
    timeSavedMinutes: aiHandled * MINUTES_PER_HANDLED,
    csatPct: csat ? Math.round((csat / 5) * 1000) / 10 : null,
    csatCount: csatAgg._count.csatRating,
    urgent: {
      openTickets,
      urgentTickets,
      highTickets,
      oldestTicketDays: oldestTicket ? Math.floor((Date.now() - oldestTicket.createdAt.getTime()) / 86_400_000) : null,
      waitingOnHuman: waiting,
      oldestWaitingHours: oldestWaiting ? Math.floor((Date.now() - oldestWaiting.lastMessageAt.getTime()) / 3_600_000) : null,
    },
    topTopics: topicGroups.map(t => ({ topic: t.topic, count: t._count._all })),
    locationChats: locationChats.rows.slice(0, 5).map(r => ({ name: r.name ?? r.locationId, count: r.count })),
    insights: aiInsights?.insights ?? [],
    leaderboard,
  }
}

/**
 * Render + send the report. `toOverride` (test sends) bypasses the
 * recipient lookup; otherwise every active, accepted portal user gets it.
 */
export async function sendPortalReport(
  portalId: string,
  opts: { windowDays: number; toOverride?: string[]; context?: string },
): Promise<{ sent: number; skipped?: string }> {
  const data = await gatherPortalReportData(portalId, opts.windowDays)
  if (!data) return { sent: 0, skipped: 'portal inactive or has no brands/widgets' }

  // The trial cliff. When every workspace behind this portal is on an
  // expired trial, the full report is withheld and a teaser goes instead:
  // the headline numbers stay visible — they are the customer's own
  // results and hiding them entirely reads as hostile — but the breakdown
  // (CSAT, topics, per-subaccount, insights) is what upgrading unlocks.
  // The widget itself keeps answering; the report about it is the lever.
  // Any single paying (or still-in-trial) workspace gets the full report.
  if (!opts.toOverride) {
    const expired = await portalTrialState(portalId).catch(() => null)
    if (expired?.allExpired) {
      return sendTrialEndedTeaser(portalId, data, expired.workspaceIds, opts.context)
    }
  }

  let recipients = opts.toOverride
  if (!recipients) {
    // receiveReports is the per-user include/exclude toggle (default on).
    // Fallback select for DBs that haven't run the column's ALTER yet.
    const users = await db.portalUser.findMany({
      where: { portalId, isActive: true, acceptedAt: { not: null }, receiveReports: true },
      select: { email: true },
    }).catch(() =>
      db.portalUser.findMany({
        where: { portalId, isActive: true, acceptedAt: { not: null } },
        select: { email: true },
      }),
    )
    recipients = users.map(u => u.email)
  }
  if (recipients.length === 0) return { sent: 0, skipped: 'no active portal users' }

  const html = renderPortalReportHtml(data)
  const text = renderPortalReportText(data)
  const subject = `${data.portalName}: your support report — ${data.aiHandled} chats handled, ${fmtTimeSaved(data.timeSavedMinutes)} saved`

  let sent = 0
  for (const to of recipients) {
    try {
      const id = await sendEmail({ to, subject, html, text, context: opts.context ?? 'portal-report' })
      if (id) sent++
    } catch (err: any) {
      console.warn('[PortalReport] send failed for', to, err?.message)
    }
  }
  return { sent }
}

/** Trial state across every workspace reachable through this portal's
 *  brands. allExpired is true only when ALL of them have lapsed —
 *  a single paying workspace keeps the full report flowing. */
async function portalTrialState(
  portalId: string,
): Promise<{ allExpired: boolean; workspaceIds: string[] }> {
  const links = await db.portalBrand.findMany({
    where: { portalId },
    select: { brand: { select: { workspaceId: true } } },
  })
  const workspaceIds = Array.from(new Set(links.map(l => l.brand.workspaceId)))
  if (workspaceIds.length === 0) return { allExpired: false, workspaceIds }

  const { getEffectivePlan } = await import('@/lib/effective-plan')
  for (const id of workspaceIds) {
    const plan = await getEffectivePlan(id)
    if (!plan.trialExpired) return { allExpired: false, workspaceIds }
  }
  return { allExpired: true, workspaceIds }
}

/**
 * The report that sells the upgrade. Headline numbers in the subject and
 * body — they did the persuading all trial, no reason to stop now — with
 * the full breakdown named as what upgrading reopens. The CTA lands on
 * the app sign-in, which is where billing lives; the portal itself has
 * no checkout.
 */
async function sendTrialEndedTeaser(
  portalId: string,
  data: NonNullable<Awaited<ReturnType<typeof gatherPortalReportData>>>,
  workspaceIds: string[],
  context?: string,
): Promise<{ sent: number; skipped?: string }> {
  const users = await db.portalUser.findMany({
    where: { portalId, isActive: true, acceptedAt: { not: null } },
    select: { email: true },
  })
  if (users.length === 0) return { sent: 0, skipped: 'no active portal users' }

  // Partner-provisioned customers upgrade in the PARTNER's product, not
  // ours — the partner records where at provision time
  // (metadata.upgradeUrl). Only when this portal belongs to no partner
  // install does the CTA fall back to our own sign-in.
  let upgradeUrl: string | null = null
  const install = await db.partnerInstall.findFirst({
    where: { workspaceId: { in: workspaceIds } },
    select: { metadata: true },
  }).catch(() => null)
  const rawUpgrade = (install?.metadata as { upgradeUrl?: unknown } | null)?.upgradeUrl
  if (typeof rawUpgrade === 'string' && /^https:\/\//i.test(rawUpgrade)) {
    upgradeUrl = rawUpgrade
  }

  const appUrl = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://xovera.io').replace(/\/$/, '')
  const cta = upgradeUrl ?? `${appUrl}/login`
  const { renderBrandedEmail, paragraphs } = await import('@/lib/email-render')
  const saved = fmtTimeSaved(data.timeSavedMinutes)

  const { html, text } = renderBrandedEmail({
    title: 'Your report is ready — your trial has ended',
    preheader: `${data.aiHandled} chats handled by AI, ~${saved} saved. Upgrade to open the full report.`,
    intro: `Your AI assistant kept working this week: ${data.aiHandled} conversations handled and roughly ${saved} of support time saved. The full report — satisfaction scores, what your clients asked about, and the per-account breakdown — is waiting in your portal.`,
    bodyHtml: paragraphs([
      `Your free trial has ended, so the portal and these weekly reports are paused. Upgrading takes a couple of minutes and everything picks up exactly where it left off — nothing has been deleted.`,
      `Your chat widget is still live and still answering your clients.`,
    ]),
    cta: { label: 'Upgrade and open your report', url: cta },
  })

  let sent = 0
  for (const u of users) {
    try {
      const id = await sendEmail({
        to: u.email,
        subject: `Your support report is ready — ${data.aiHandled} chats handled, ~${saved} saved`,
        html, text,
        context: context ?? 'portal-report-trial-ended',
      })
      if (id) sent++
    } catch (err: any) {
      console.warn('[PortalReport] teaser send failed for', u.email, err?.message)
    }
  }
  return { sent }
}
