/**
 * Pure HTML/text rendering for the scheduled portal report email.
 * No imports from db/server modules — keep it that way so the template
 * can be previewed standalone (and unit-tested) without a database.
 *
 * Email-client constraints honored throughout: tables for layout,
 * inline styles only, no external CSS/fonts, system font stack.
 */

import type { PortalAiInsight } from '@/lib/portal/ai-insights'
import type { LeaderboardEntry } from '@/lib/portal/leaderboard'

export const MINUTES_PER_HANDLED = 7

export interface PortalReportData {
  portalName: string
  logoUrl: string | null
  primaryColor: string
  portalUrl: string
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
  leaderboard: LeaderboardEntry[]
}

export function fmtTimeSaved(minutes: number): string {
  if (minutes < 60) return `${minutes} min`
  const h = minutes / 60
  return h >= 10 ? `${Math.round(h)} hours` : `${Math.round(h * 10) / 10} hours`
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// Neutral ink + paper palette; the portal's accent is used sparingly for
// emphasis so any brand color looks intentional.
const INK = '#22211f'
const INK_SOFT = '#63625e'
const FAINT = '#989793'
const PAPER = '#f7f6f3'
const LINE = '#eceae5'

function movementChip(e: LeaderboardEntry): string {
  if (e.movement === null) {
    return `<span style="font-size:10px;font-weight:700;color:#7c6cd9;background:#f0edfc;border-radius:20px;padding:2px 8px;">new</span>`
  }
  if (e.movement > 0) {
    return `<span style="font-size:10px;font-weight:700;color:#2e7d4f;background:#eaf5ee;border-radius:20px;padding:2px 8px;">▲ ${e.movement}</span>`
  }
  if (e.movement < 0) {
    return `<span style="font-size:10px;font-weight:700;color:#b3593a;background:#fbf0ea;border-radius:20px;padding:2px 8px;">▼ ${Math.abs(e.movement)}</span>`
  }
  return `<span style="font-size:10px;font-weight:700;color:${INK_SOFT};background:${PAPER};border-radius:20px;padding:2px 8px;">—</span>`
}

function rankBadge(rank: number, accent: string): string {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  if (medal) return `<span style="font-size:17px;">${medal}</span>`
  return `<span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:${PAPER};border:1px solid ${LINE};font-size:11px;font-weight:700;color:${INK_SOFT};">${rank}</span>`
}

export function renderPortalReportHtml(d: PortalReportData): string {
  const accent = d.primaryColor
  const period = d.windowDays === 1 ? 'Yesterday' : `Last ${d.windowDays} days`

  const kpi = (label: string, value: string, sub?: string) => `
    <td width="25%" style="padding:0 4px;">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:14px 12px;background:${PAPER};border:1px solid ${LINE};border-radius:12px;">
          <div style="font-size:10px;letter-spacing:1.2px;text-transform:uppercase;color:${FAINT};font-weight:700;">${label}</div>
          <div style="font-size:23px;font-weight:800;color:${INK};margin-top:5px;letter-spacing:-0.5px;">${value}</div>
          <div style="font-size:10px;color:${FAINT};margin-top:2px;min-height:12px;">${sub ?? '&nbsp;'}</div>
        </td>
      </tr></table>
    </td>`

  const sectionTitle = (emoji: string, title: string, sub?: string) => `
    <div style="margin-bottom:10px;">
      <span style="font-size:13px;font-weight:800;color:${INK};letter-spacing:-0.2px;">${emoji} ${title}</span>
      ${sub ? `<span style="font-size:11px;color:${FAINT};"> — ${sub}</span>` : ''}
    </div>`

  const urgentRows: string[] = []
  if (d.urgent.urgentTickets > 0) urgentRows.push(`<strong style="color:#b3402e;">${d.urgent.urgentTickets} urgent ticket${d.urgent.urgentTickets === 1 ? '' : 's'}</strong> waiting`)
  if (d.urgent.highTickets > 0) urgentRows.push(`${d.urgent.highTickets} high-priority ticket${d.urgent.highTickets === 1 ? '' : 's'} open`)
  if (d.urgent.openTickets > 0) urgentRows.push(`${d.urgent.openTickets} open ticket${d.urgent.openTickets === 1 ? '' : 's'} in total${d.urgent.oldestTicketDays != null && d.urgent.oldestTicketDays > 0 ? ` · oldest ${d.urgent.oldestTicketDays}d` : ''}`)
  if (d.urgent.waitingOnHuman > 0) urgentRows.push(`<strong style="color:#b3402e;">${d.urgent.waitingOnHuman} chat${d.urgent.waitingOnHuman === 1 ? '' : 's'} waiting on a human</strong>${d.urgent.oldestWaitingHours != null && d.urgent.oldestWaitingHours > 0 ? ` · longest ${d.urgent.oldestWaitingHours}h` : ''}`)

  const leaderboardSection = d.leaderboard.length === 0 ? '' : `
  <tr><td style="padding:26px 32px 0;">
    ${sectionTitle('🏆', 'Support MVPs', 'your most engaged people this week')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:#ffffff;">
      ${d.leaderboard.map((e, i) => `
      <tr>
        <td width="34" align="center" style="padding:10px 4px 10px 14px;${i > 0 ? `border-top:1px solid ${LINE};` : ''}">${rankBadge(e.rank, accent)}</td>
        <td style="padding:10px 8px;${i > 0 ? `border-top:1px solid ${LINE};` : ''}">
          <div style="font-size:13px;font-weight:600;color:${INK};">${esc(e.name ?? e.email)}</div>
          <div style="font-size:11px;color:${FAINT};">${e.chats} chat${e.chats === 1 ? '' : 's'}${e.tickets > 0 ? ` · ${e.tickets} ticket${e.tickets === 1 ? '' : 's'}` : ''}</div>
        </td>
        <td align="right" style="padding:10px 8px;${i > 0 ? `border-top:1px solid ${LINE};` : ''}">${movementChip(e)}</td>
        <td width="44" align="right" style="padding:10px 16px 10px 4px;font-size:15px;font-weight:800;color:${INK};${i > 0 ? `border-top:1px solid ${LINE};` : ''}">${e.score}</td>
      </tr>`).join('')}
    </table>
    <div style="font-size:11px;color:${FAINT};margin-top:8px;line-height:1.5;">
      Heavy use is a good sign — engaged people ask questions. It's also your best map of
      where a help doc or a quick loom could save everyone a trip.
    </div>
  </td></tr>`

  const listSection = (emoji: string, title: string, sub: string, rows: { label: string; value: string }[]) => rows.length === 0 ? '' : `
    <tr><td style="padding:26px 32px 0;">
      ${sectionTitle(emoji, title, sub)}
      <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:#ffffff;">
        ${rows.map((r, i) => `
        <tr>
          <td style="padding:10px 16px;font-size:13px;color:${INK};${i > 0 ? `border-top:1px solid ${LINE};` : ''}">${r.label}</td>
          <td align="right" style="padding:10px 16px;font-size:13px;font-weight:700;color:${INK_SOFT};${i > 0 ? `border-top:1px solid ${LINE};` : ''}">${r.value}</td>
        </tr>`).join('')}
      </table>
    </td></tr>`

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#edece8;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;">${esc(d.portalName)}: ${d.aiHandled} chats handled by AI, ~${fmtTimeSaved(d.timeSavedMinutes)} saved${d.urgent.openTickets > 0 ? `, ${d.urgent.openTickets} tickets open` : ''}.</div>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#edece8;padding:28px 12px;"><tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e0dfda;">

  <tr><td style="padding:30px 32px 22px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td>
        ${d.logoUrl ? `<img src="${d.logoUrl}" alt="${esc(d.portalName)}" height="28" style="display:block;margin-bottom:12px;" />` : ''}
        <div style="font-size:22px;font-weight:800;color:${INK};letter-spacing:-0.4px;">${esc(d.portalName)}</div>
        <div style="font-size:13px;color:${INK_SOFT};margin-top:2px;">Support report · ${period.toLowerCase()}</div>
      </td>
      <td align="right" valign="top">
        <a href="${d.portalUrl}" style="display:inline-block;background:${accent};color:#ffffff;font-size:13px;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:10px;">Open portal →</a>
      </td>
    </tr></table>
  </td></tr>

  <tr><td style="padding:0 32px;"><div style="height:4px;background:${accent};border-radius:4px;"></div></td></tr>

  <tr><td style="padding:22px 28px 0;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      ${kpi('Conversations', String(d.totalConversations))}
      ${kpi('AI handled', String(d.aiHandled), 'no human needed')}
      ${kpi('CSAT', d.csatPct != null ? `${d.csatPct}%` : '—', d.csatCount > 0 ? `${d.csatCount} ratings` : 'no ratings yet')}
      ${kpi('Open tickets', String(d.urgent.openTickets))}
    </tr></table>
  </td></tr>

  <tr><td style="padding:24px 32px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="border-radius:12px;background:linear-gradient(135deg, ${accent}18, ${accent}0a);border:1px solid ${accent}45;">
      <tr>
        <td style="padding:18px 20px;">
          <div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;color:${accent};font-weight:800;">⏱ Estimated time saved</div>
          <div style="font-size:30px;font-weight:800;color:${INK};margin-top:4px;letter-spacing:-0.8px;">${fmtTimeSaved(d.timeSavedMinutes)}</div>
          <div style="font-size:12px;color:${INK_SOFT};margin-top:4px;line-height:1.5;">
            ${d.aiHandled} conversations fully handled by your AI — about ${MINUTES_PER_HANDLED} minutes each your team got back.
          </div>
        </td>
      </tr>
    </table>
  </td></tr>

  ${urgentRows.length > 0 ? `
  <tr><td style="padding:26px 32px 0;">
    ${sectionTitle('🚩', 'Needs attention')}
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf4f1;border:1px solid #f2d5cb;border-radius:12px;">
      <tr><td style="padding:14px 18px;">
        ${urgentRows.map(r => `<div style="font-size:13px;color:${INK};padding:3px 0;line-height:1.5;">• ${r}</div>`).join('')}
      </td></tr>
    </table>
  </td></tr>` : `
  <tr><td style="padding:26px 32px 0;">
    <div style="font-size:13px;color:#2e7d4f;background:#f1f8f3;border:1px solid #d3e8da;border-radius:12px;padding:14px 18px;">
      ✓ All clear — no open tickets, nothing waiting on a human.
    </div>
  </td></tr>`}

  ${leaderboardSection}

  ${d.insights.length > 0 ? `
  <tr><td style="padding:26px 32px 0;">
    ${sectionTitle('✦', 'AI insights', 'what your customers keep asking about')}
    ${d.insights.map(i => `
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${LINE};border-radius:12px;background:${PAPER};margin-bottom:8px;">
      <tr><td style="padding:14px 18px;">
        <div style="font-size:14px;font-weight:700;color:${INK};letter-spacing:-0.2px;">${esc(i.headline)}</div>
        <div style="font-size:12px;color:${INK_SOFT};margin-top:5px;line-height:1.55;">${esc(i.detail)}</div>
        <div style="font-size:12px;margin-top:8px;line-height:1.5;"><span style="font-weight:800;color:${accent};">→ Suggested:</span> <span style="color:${INK};">${esc(i.suggestedAction)}</span></div>
      </td></tr>
    </table>`).join('')}
  </td></tr>` : ''}

  ${listSection('💬', 'Top topics', 'most-matched knowledge', d.topTopics.map(t => ({ label: esc(t.topic), value: `${t.count}` })))}
  ${listSection('📍', 'Chats by sub-account', 'where conversations came from', d.locationChats.map(l => ({ label: esc(l.name), value: String(l.count) })))}

  <tr><td style="padding:30px 32px 28px;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" style="padding-bottom:18px;">
        <a href="${d.portalUrl}" style="display:inline-block;background:${accent};color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:12px 26px;border-radius:10px;">Open your portal →</a>
      </td>
    </tr></table>
    <div style="font-size:11px;color:${FAINT};line-height:1.6;border-top:1px solid ${LINE};padding-top:14px;">
      Time saved is an estimate (~${MINUTES_PER_HANDLED} min per AI-handled conversation).
      You're receiving this because scheduled reports are on for your support portal —
      change the cadence anytime in your portal's Settings.
    </div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`
}

export function renderPortalReportText(d: PortalReportData): string {
  const lines = [
    `${d.portalName} — Support Report (last ${d.windowDays} days)`,
    d.portalUrl,
    '',
    `Conversations: ${d.totalConversations}`,
    `AI handled: ${d.aiHandled}`,
    `Estimated time saved: ${fmtTimeSaved(d.timeSavedMinutes)} (~${MINUTES_PER_HANDLED} min per AI-handled conversation)`,
    d.csatPct != null ? `CSAT: ${d.csatPct}% (${d.csatCount} ratings)` : 'CSAT: no ratings yet',
    `Open tickets: ${d.urgent.openTickets} (${d.urgent.urgentTickets} urgent, ${d.urgent.highTickets} high)`,
    `Chats waiting on a human: ${d.urgent.waitingOnHuman}`,
  ]
  if (d.leaderboard.length) {
    lines.push('', 'Support MVPs:')
    for (const e of d.leaderboard) {
      const move = e.movement === null ? 'new' : e.movement > 0 ? `up ${e.movement}` : e.movement < 0 ? `down ${Math.abs(e.movement)}` : 'held'
      lines.push(`${e.rank}. ${e.name ?? e.email} — ${e.score} (${e.chats} chats, ${e.tickets} tickets, ${move})`)
    }
  }
  if (d.insights.length) {
    lines.push('', 'AI insights:')
    for (const i of d.insights) lines.push(`- ${i.headline} — ${i.detail} Suggested: ${i.suggestedAction}`)
  }
  return lines.join('\n')
}
