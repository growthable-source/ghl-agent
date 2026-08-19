/**
 * Trial-ending emails for help-center installs — two audiences:
 *
 *  - internalDigest: a daily heads-up to the Growthable team listing
 *    which customers' trials end in the next 24h, so someone can reach
 *    out (or unlock) before they lapse.
 *  - customerTrialEnding: the marketing/sales email to the customer —
 *    value-first (what their AI actually did), then two clear upgrade
 *    paths (self-serve AI, or a sales conversation about human support).
 *
 * Growthable-branded; email constraints as elsewhere (inline styles,
 * table layout, system fonts).
 */

import type { InstallUsage } from './install-usage'

const INK = '#25313d'
const HEADING = '#34475b'
const ACCENT = '#f03e6a'
const PAPER = '#fbfaf8'
const RULE = '#e4e2dc'
const FAINT = '#8b949e'
const TILE = '#f4f2ee'
const SANS = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

function esc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function hoursSaved(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`
  const h = minutes / 60
  return `${h >= 10 ? Math.round(h) : h.toFixed(1)} hrs`
}

// ─── Customer email ──────────────────────────────────────────────────

export interface CustomerTrialInput {
  businessName: string
  usage: InstallUsage
  hoursRemaining: number
  /** GKB dashboard origin — the self-serve "keep my AI" upgrade page. */
  dashboardOrigin: string | null
  /** Where "talk to sales" goes (booking link). */
  salesUrl: string
}

export function customerTrialSubject(input: CustomerTrialInput): string {
  const c = input.usage.conversationCount
  return c > 0
    ? `Your AI answered ${c.toLocaleString()} ${c === 1 ? 'question' : 'questions'} — keep it before your trial ends`
    : `${input.businessName}: your AI help centre trial ends soon`
}

function statTiles(u: InstallUsage): string {
  const tiles: Array<{ big: string; small: string }> = [
    { big: u.conversationCount.toLocaleString(), small: u.conversationCount === 1 ? 'conversation answered' : 'conversations answered' },
    { big: u.aiHandled7d.toLocaleString(), small: 'handled with zero human effort (7d)' },
    { big: hoursSaved(u.timeSavedMinutes7d), small: 'of your team\'s time saved (7d)' },
  ]
  if (u.csatCount > 0 && u.csatAvg != null) {
    tiles.push({ big: `${u.csatAvg.toFixed(1)}★`, small: `client satisfaction (${u.csatCount})` })
  }
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${tiles.map(t => `
    <td width="${Math.floor(100 / tiles.length)}%" style="padding:6px;" valign="top">
      <div style="background:${TILE};border-radius:10px;padding:14px 12px;text-align:center;">
        <div style="font-family:${SANS};font-size:22px;font-weight:800;color:${HEADING};letter-spacing:-0.02em;">${esc(t.big)}</div>
        <div style="font-family:${SANS};font-size:11px;line-height:1.35;color:${FAINT};margin-top:4px;">${esc(t.small)}</div>
      </div>
    </td>`).join('')}</tr></table>`
}

function button(label: string, url: string, primary: boolean): string {
  const bg = primary ? ACCENT : '#ffffff'
  const color = primary ? '#ffffff' : HEADING
  const border = primary ? ACCENT : RULE
  return `<a href="${esc(url)}" style="display:inline-block;margin:0 8px 8px 0;background:${bg};color:${color};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;padding:12px 22px;border-radius:8px;border:1px solid ${border};">${esc(label)}</a>`
}

export function customerTrialHtml(input: CustomerTrialInput): string {
  const u = input.usage
  const d = input.dashboardOrigin?.replace(/\/+$/, '') ?? null
  const keepUrl = d ? `${d}/dashboard/ai-agent` : input.salesUrl
  const hrs = Math.max(1, Math.round(input.hoursRemaining))
  const hasActivity = u.conversationCount > 0

  const heroBlock = hasActivity
    ? `<tr><td style="padding:8px 32px 0 32px;">
        <p style="margin:0 0 12px 0;font-family:${SANS};font-size:14px;line-height:1.6;color:${INK};">In just your trial, your AI assistant has been earning its keep:</p>
        ${statTiles(u)}
      </td></tr>`
    : `<tr><td style="padding:8px 32px 0 32px;">
        <p style="margin:0;font-family:${SANS};font-size:14px;line-height:1.6;color:${INK};">Your AI help centre is set up and live — now's the moment to point your clients at it and let it start deflecting questions for you, before the trial wraps up.</p>
      </td></tr>`

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${esc(customerTrialSubject(input))}</title></head>
<body style="margin:0;padding:0;background:${PAPER};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">What your AI did, what you keep, and how to go further.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAPER};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border:1px solid ${RULE};border-radius:12px;">
<tr><td style="padding:28px 32px 0 32px;">
  <span style="font-family:${SANS};font-size:19px;font-weight:800;letter-spacing:-0.02em;color:${HEADING};">Growthable</span>
</td></tr>
<tr><td style="padding:16px 32px 0 32px;">
  <span style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">Your trial ends in ~${hrs} hours</span>
  <h1 style="margin:8px 0 0 0;font-family:${SANS};font-size:25px;line-height:1.15;font-weight:800;letter-spacing:-0.025em;color:${HEADING};">Keep ${esc(input.businessName)} running on autopilot.</h1>
</td></tr>
${heroBlock}

<tr><td style="padding:24px 32px 0 32px;">
  <div style="border:1px solid ${RULE};border-radius:12px;padding:18px 20px;">
    <span style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">Keep the AI · Agency AI · $197/mo</span>
    <h2 style="margin:6px 0 0 0;font-family:${SANS};font-size:18px;font-weight:800;color:${HEADING};letter-spacing:-0.02em;">Everything you're using, kept on — plus human handoff.</h2>
    <p style="margin:8px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${INK};">Your whitelabel AI assistant keeps answering clients around the clock, your client portal and weekly performance reports stay on, and you unlock human handoff so the AI can pass a tricky chat to a real person. Up to 35 sub-accounts, and it already resolves 40–60% of queries on its own.</p>
    <div style="margin-top:14px;">${button('Keep my AI help centre', keepUrl, true)}</div>
  </div>
</td></tr>

<tr><td style="padding:16px 32px 0 32px;">
  <div style="border:1px solid ${RULE};border-radius:12px;padding:18px 20px;background:${TILE};">
    <span style="font-family:${SANS};font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${ACCENT};">Go further · Whitelabel Support</span>
    <h2 style="margin:6px 0 0 0;font-family:${SANS};font-size:18px;font-weight:800;color:${HEADING};letter-spacing:-0.02em;">Want real people answering your clients — not just AI?</h2>
    <p style="margin:8px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${INK};">Our Whitelabel Support team answers your clients 24/7/365 under your brand — live chat, ticketing and Zoom — with done-for-you onboarding and A2P/compliance handled. It's the natural step up when AI-first isn't enough. Let's find the tier that fits your agency.</p>
    <div style="margin-top:14px;">${button('Talk to sales about human support', input.salesUrl, false)}</div>
  </div>
</td></tr>

<tr><td style="padding:18px 32px 0 32px;">
  <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${FAINT};">There's more where that came from — AI phone support, theme &amp; login-page builders, agency power tools. See it all at <a href="https://growthable.io" style="color:${ACCENT};text-decoration:none;">growthable.io</a>.</p>
</td></tr>

<tr><td style="padding:22px 32px 28px 32px;border-top:1px solid ${RULE};margin-top:22px;">
  <p style="margin:22px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${INK};">Not sure which way to go? Just reply — a real human (not the AI 😉) will help you pick.</p>
  <p style="margin:10px 0 0 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${FAINT};">— Dan, Growthable</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`
}

export function customerTrialText(input: CustomerTrialInput): string {
  const u = input.usage
  const d = input.dashboardOrigin?.replace(/\/+$/, '') ?? null
  const keepUrl = d ? `${d}/dashboard/ai-agent` : input.salesUrl
  const lines = [
    `Your Growthable AI help centre trial ends in about ${Math.max(1, Math.round(input.hoursRemaining))} hours.`,
    '',
  ]
  if (u.conversationCount > 0) {
    lines.push(
      'In your trial, your AI assistant:',
      `- Answered ${u.conversationCount.toLocaleString()} conversations`,
      `- Handled ${u.aiHandled7d.toLocaleString()} with zero human effort (last 7 days)`,
      `- Saved ${hoursSaved(u.timeSavedMinutes7d)} of your team's time (last 7 days)`,
      ...(u.csatCount > 0 && u.csatAvg != null ? [`- ${u.csatAvg.toFixed(1)}/5 client satisfaction (${u.csatCount} ratings)`] : []),
      '',
    )
  }
  lines.push(
    'KEEP THE AI — Agency AI, $197/mo',
    'Keep your whitelabel AI assistant, client portal and weekly reports, and unlock human handoff. Up to 35 sub-accounts; resolves 40-60% of queries.',
    `Keep it: ${keepUrl}`,
    '',
    'GO FURTHER — Whitelabel Support',
    'A real 24/7/365 support team answering your clients under your brand: live chat, ticketing, Zoom, done-for-you onboarding, compliance handled.',
    `Talk to sales: ${input.salesUrl}`,
    '',
    'See everything at https://growthable.io',
    '',
    'Not sure which way to go? Just reply — a real human will help.',
    '',
    '— Dan, Growthable',
  )
  return lines.join('\n')
}

// ─── Internal digest ─────────────────────────────────────────────────

export interface DigestRow {
  businessName: string
  email: string
  hoursRemaining: number
  usage: InstallUsage
  adminUrl: string
}

export function internalDigestSubject(rows: DigestRow[]): string {
  return `${rows.length} help-centre trial${rows.length === 1 ? '' : 's'} ending in the next 24h`
}

export function internalDigestHtml(rows: DigestRow[]): string {
  const body = rows.map(r => `
    <tr>
      <td style="padding:10px 12px;border-top:1px solid ${RULE};font-family:${SANS};font-size:13px;color:${HEADING};font-weight:600;">${esc(r.businessName)}<div style="font-weight:400;color:${FAINT};font-size:11px;">${esc(r.email)}</div></td>
      <td style="padding:10px 12px;border-top:1px solid ${RULE};font-family:${SANS};font-size:13px;color:${INK};white-space:nowrap;">~${Math.max(1, Math.round(r.hoursRemaining))}h</td>
      <td style="padding:10px 12px;border-top:1px solid ${RULE};font-family:${SANS};font-size:12px;color:${INK};">${r.usage.conversationCount.toLocaleString()} convos · ${r.usage.aiHandled7d.toLocaleString()} AI-handled (7d)</td>
      <td style="padding:10px 12px;border-top:1px solid ${RULE};"><a href="${esc(r.adminUrl)}" style="font-family:${SANS};font-size:12px;color:${ACCENT};text-decoration:none;font-weight:600;">Unlock →</a></td>
    </tr>`).join('')
  return `<!doctype html><html><body style="margin:0;padding:24px;background:${PAPER};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ${RULE};border-radius:12px;">
<tr><td style="padding:20px 20px 0 20px;">
  <h1 style="margin:0;font-family:${SANS};font-size:18px;font-weight:800;color:${HEADING};">${rows.length} trial${rows.length === 1 ? '' : 's'} ending in the next 24 hours</h1>
  <p style="margin:6px 0 0 0;font-family:${SANS};font-size:13px;color:${FAINT};">Reach out or unlock before they lapse.</p>
</td></tr>
<tr><td style="padding:14px 8px 16px 8px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${body}</table>
</td></tr>
</table></body></html>`
}

export function internalDigestText(rows: DigestRow[]): string {
  return [
    `${rows.length} help-centre trial(s) ending in the next 24h:`,
    '',
    ...rows.map(r => `- ${r.businessName} (${r.email}) — ~${Math.max(1, Math.round(r.hoursRemaining))}h — ${r.usage.conversationCount} convos, ${r.usage.aiHandled7d} AI-handled (7d) — unlock: ${r.adminUrl}`),
  ].join('\n')
}
