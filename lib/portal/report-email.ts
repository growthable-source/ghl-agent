/**
 * Scheduled portal email reports — the portal Overview, as an HTML email.
 *
 * Sections: headline KPIs, an estimated-time-saved callout, outstanding &
 * urgent items (open tickets by priority, chats waiting on a human), top
 * topics, chats per sub-account, and the cached AI insights briefing.
 *
 * Time saved is an ESTIMATE and labeled as such in the email: AI-handled
 * conversations (no human ever assigned, and a real exchange happened)
 * × MINUTES_PER_HANDLED. The constant is deliberately conservative vs
 * industry averages for live-chat handle time.
 *
 * Reused by: the hourly cron (schedule from Portal.reportFrequency), the
 * admin "send test" button, and the portal settings test-send.
 */

import { db } from '@/lib/db'
import { sendEmail } from '@/lib/email-send'
import { getChatsPerLocation } from '@/lib/portal/subaccount-stats'
import { getPortalAiInsights, type PortalAiInsight } from '@/lib/portal/ai-insights'

const MINUTES_PER_HANDLED = 7

export interface PortalReportData {
  portalName: string
  logoUrl: string | null
  primaryColor: string
  windowDays: number
  totalConversations: number
  aiHandled: number
  timeSavedMinutes: number
  csatPct: number | null
  csatCount: number
  urgent: {
    openTickets: number
    urgentTickets: number
    highTickets: number
    oldestTicketDays: number | null
    waitingOnHuman: number
    oldestWaitingHours: number | null
  }
  topTopics: { topic: string; count: number }[]
  locationChats: { name: string; count: number }[]
  insights: PortalAiInsight[]
}

export async function gatherPortalReportData(portalId: string, windowDays: number): Promise<PortalReportData | null> {
  const portal = await db.portal.findUnique({
    where: { id: portalId },
    select: {
      name: true, logoUrl: true, primaryColor: true, isActive: true,
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

  const since = new Date(Date.now() - windowDays * 86_400_000)
  const base = { widgetId: { in: widgetIds } }

  const [total, aiHandled, csatAgg, openTickets, urgentTickets, highTickets, oldestTicket, waiting, oldestWaiting, topicGroups, locationChats, aiInsights] =
    await Promise.all([
      db.widgetConversation.count({ where: { ...base, createdAt: { gte: since } } }),
      // AI-handled = a real exchange happened and no human was ever
      // assigned. messages >= 2 filters out drive-by opens.
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
    ])

  const csat = csatAgg._avg.csatRating
  return {
    portalName: portal.name,
    logoUrl: portal.logoUrl,
    primaryColor: portal.primaryColor || '#e88b25',
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
  }
}

function fmtTimeSaved(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = minutes / 60
  return h >= 10 ? `${Math.round(h)} hours` : `${Math.round(h * 10) / 10} hours`
}

/** Email-client-safe HTML: tables, inline styles, no external CSS. */
export function renderPortalReportHtml(d: PortalReportData): string {
  const accent = d.primaryColor
  const period = d.windowDays === 1 ? 'Yesterday' : `Last ${d.windowDays} days`
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const kpi = (label: string, value: string, sub?: string) => `
    <td width="25%" style="padding:14px 12px;background:#fafaf7;border:1px solid #ececec;border-radius:10px;">
      <div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:#8a8a86;font-weight:700;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#1c1c1a;margin-top:4px;">${value}</div>
      ${sub ? `<div style="font-size:10px;color:#8a8a86;margin-top:2px;">${sub}</div>` : ''}
    </td>`

  const urgentRows: string[] = []
  if (d.urgent.urgentTickets > 0) urgentRows.push(`<strong style="color:#c0392b;">${d.urgent.urgentTickets} urgent ticket${d.urgent.urgentTickets === 1 ? '' : 's'}</strong> need attention`)
  if (d.urgent.highTickets > 0) urgentRows.push(`${d.urgent.highTickets} high-priority ticket${d.urgent.highTickets === 1 ? '' : 's'} open`)
  if (d.urgent.openTickets > 0) urgentRows.push(`${d.urgent.openTickets} ticket${d.urgent.openTickets === 1 ? '' : 's'} open in total${d.urgent.oldestTicketDays != null && d.urgent.oldestTicketDays > 0 ? ` · oldest ${d.urgent.oldestTicketDays}d` : ''}`)
  if (d.urgent.waitingOnHuman > 0) urgentRows.push(`<strong style="color:#c0392b;">${d.urgent.waitingOnHuman} chat${d.urgent.waitingOnHuman === 1 ? '' : 's'} waiting on a human</strong>${d.urgent.oldestWaitingHours != null && d.urgent.oldestWaitingHours > 0 ? ` · longest wait ${d.urgent.oldestWaitingHours}h` : ''}`)

  const listSection = (title: string, rows: { label: string; value: string }[]) => rows.length === 0 ? '' : `
    <tr><td style="padding:22px 28px 0;">
      <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8a86;font-weight:700;margin-bottom:8px;">${title}</div>
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececec;border-radius:10px;background:#fafaf7;">
        ${rows.map((r, i) => `
        <tr>
          <td style="padding:9px 14px;font-size:13px;color:#1c1c1a;${i > 0 ? 'border-top:1px solid #ececec;' : ''}">${r.label}</td>
          <td align="right" style="padding:9px 14px;font-size:13px;font-weight:700;color:#5c5c58;${i > 0 ? 'border-top:1px solid #ececec;' : ''}">${r.value}</td>
        </tr>`).join('')}
      </table>
    </td></tr>`

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#efeeea;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#efeeea;padding:24px 12px;"><tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e1dd;">

  <tr><td style="padding:26px 28px 20px;border-bottom:4px solid ${accent};">
    ${d.logoUrl ? `<img src="${d.logoUrl}" alt="${esc(d.portalName)}" height="30" style="display:block;margin-bottom:10px;" />` : ''}
    <div style="font-size:20px;font-weight:800;color:#1c1c1a;">${esc(d.portalName)} — Support Report</div>
    <div style="font-size:12px;color:#8a8a86;margin-top:3px;">${period} · generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  </td></tr>

  <tr><td style="padding:22px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="6"><tr>
      ${kpi('Conversations', String(d.totalConversations))}
      ${kpi('AI handled', String(d.aiHandled), 'no human needed')}
      ${kpi('CSAT', d.csatPct != null ? `${d.csatPct}%` : '—', `${d.csatCount} ratings`)}
      ${kpi('Open tickets', String(d.urgent.openTickets))}
    </tr></table>
  </td></tr>

  <tr><td style="padding:18px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:${accent}14;border:1px solid ${accent}55;border-radius:10px;">
      <tr><td style="padding:16px 18px;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:${accent};font-weight:800;">⏱ Estimated time saved</div>
        <div style="font-size:26px;font-weight:800;color:#1c1c1a;margin-top:4px;">${fmtTimeSaved(d.timeSavedMinutes)}</div>
        <div style="font-size:11px;color:#8a8a86;margin-top:4px;">
          ${d.aiHandled} conversations fully handled by your AI assistant × ~${MINUTES_PER_HANDLED} min each that your team didn't have to spend.
        </div>
      </td></tr>
    </table>
  </td></tr>

  ${urgentRows.length > 0 ? `
  <tr><td style="padding:18px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf3f2;border:1px solid #f0c9c4;border-radius:10px;">
      <tr><td style="padding:14px 18px;">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#c0392b;font-weight:800;">Needs attention</div>
        ${urgentRows.map(r => `<div style="font-size:13px;color:#1c1c1a;margin-top:6px;">• ${r}</div>`).join('')}
      </td></tr>
    </table>
  </td></tr>` : `
  <tr><td style="padding:18px 28px 0;">
    <div style="font-size:13px;color:#2e7d4f;background:#f0f7f2;border:1px solid #cfe5d6;border-radius:10px;padding:12px 18px;">✓ Nothing outstanding — no open tickets and no chats waiting on a human.</div>
  </td></tr>`}

  ${d.insights.length > 0 ? `
  <tr><td style="padding:22px 28px 0;">
    <div style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#8a8a86;font-weight:700;margin-bottom:8px;">✦ AI insights</div>
    ${d.insights.map(i => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececec;border-radius:10px;background:#fafaf7;margin-bottom:8px;">
      <tr><td style="padding:13px 16px;">
        <div style="font-size:14px;font-weight:700;color:#1c1c1a;">${esc(i.headline)}</div>
        <div style="font-size:12px;color:#5c5c58;margin-top:4px;line-height:1.5;">${esc(i.detail)}</div>
        <div style="font-size:12px;margin-top:6px;"><span style="font-weight:700;color:${accent};">Suggested:</span> <span style="color:#1c1c1a;">${esc(i.suggestedAction)}</span></div>
      </td></tr>
    </table>`).join('')}
  </td></tr>` : ''}

  ${listSection('Top topics', d.topTopics.map(t => ({ label: esc(t.topic), value: `${t.count} chats` })))}
  ${listSection('Chats by sub-account', d.locationChats.map(l => ({ label: esc(l.name), value: String(l.count) })))}

  <tr><td style="padding:24px 28px 26px;">
    <div style="font-size:11px;color:#a5a5a1;line-height:1.6;border-top:1px solid #ececec;padding-top:14px;">
      Time saved is an estimate (~${MINUTES_PER_HANDLED} min per AI-handled conversation). You're receiving this because
      scheduled reports are enabled for your support portal — manage this in your portal's Settings.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

export function renderPortalReportText(d: PortalReportData): string {
  const lines = [
    `${d.portalName} — Support Report (last ${d.windowDays} days)`,
    '',
    `Conversations: ${d.totalConversations}`,
    `AI handled: ${d.aiHandled}`,
    `Estimated time saved: ${fmtTimeSaved(d.timeSavedMinutes)} (~${MINUTES_PER_HANDLED} min per AI-handled conversation)`,
    d.csatPct != null ? `CSAT: ${d.csatPct}% (${d.csatCount} ratings)` : 'CSAT: no ratings yet',
    `Open tickets: ${d.urgent.openTickets} (${d.urgent.urgentTickets} urgent, ${d.urgent.highTickets} high)`,
    `Chats waiting on a human: ${d.urgent.waitingOnHuman}`,
  ]
  if (d.insights.length) {
    lines.push('', 'AI insights:')
    for (const i of d.insights) lines.push(`- ${i.headline} — ${i.detail} Suggested: ${i.suggestedAction}`)
  }
  return lines.join('\n')
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

  let recipients = opts.toOverride
  if (!recipients) {
    const users = await db.portalUser.findMany({
      where: { portalId, isActive: true, acceptedAt: { not: null } },
      select: { email: true },
    })
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
