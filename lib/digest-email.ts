/**
 * Render and send the weekly digest email.
 *
 * Uses the same Resend setup as lib/notifications.ts but a richer HTML
 * template (the headline tiles + per-agent table), since the digest is
 * data-dense rather than a single notification.
 *
 * Required env:
 *   RESEND_API_KEY
 *   NOTIFICATION_FROM_EMAIL  (defaults to "Voxility <notifications@voxility.app>")
 *   APP_URL                  (used for the "Open dashboard" CTA)
 */

import type { DigestPayload } from './digest-builder'

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!))
}

function fmtDate(d: Date): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US')
}

export function renderDigestSubject(payload: DigestPayload, workspaceName: string): string {
  const t = payload.totals
  if (t.messages === 0) {
    return `${workspaceName}: a quiet week (no agent activity)`
  }
  const headline = t.appointments > 0
    ? `${t.appointments} appointment${t.appointments === 1 ? '' : 's'} booked`
    : `${fmtNum(t.messages)} messages handled`
  return `${workspaceName} weekly digest — ${headline}`
}

interface RenderOpts {
  workspaceId: string
  workspaceName: string
  recipientName?: string | null
  appUrl?: string
}

export function renderDigestHtml(payload: DigestPayload, opts: RenderOpts): string {
  const { workspaceId, workspaceName, recipientName, appUrl } = opts
  const t = payload.totals
  const dashUrl = `${appUrl || ''}/dashboard/${workspaceId}/digest`
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,'
  const range = `${fmtDate(payload.weekStart)} — ${fmtDate(payload.weekEnd)}`

  const deltaChip = t.deltaVsLastWeek === null
    ? ''
    : `<span style="display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:${t.deltaVsLastWeek >= 0 ? '#d1fae5' : '#fee2e2'};color:${t.deltaVsLastWeek >= 0 ? '#065f46' : '#991b1b'};">${t.deltaVsLastWeek >= 0 ? '+' : ''}${t.deltaVsLastWeek}% vs last week</span>`

  const tile = (label: string, value: string, sub?: string) => `
    <td style="padding:12px;background:#f9fafb;border-radius:8px;width:25%;vertical-align:top;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;margin-bottom:4px;">${label}</div>
      <div style="font-size:22px;font-weight:700;color:#111827;line-height:1.1;">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${sub}</div>` : ''}
    </td>`

  const totalsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 0 24px;">
      <tr>
        ${tile('Messages', fmtNum(t.messages))}
        ${tile('Appointments', fmtNum(t.appointments))}
        ${tile('Follow-ups', fmtNum(t.followUpsSent))}
        ${tile('Est. cost', `$${t.estCost.toFixed(2)}`, `${(t.tokens / 1000).toFixed(0)}k tokens`)}
      </tr>
    </table>`

  const topAgents = payload.agents.slice(0, 8)
  const agentRows = topAgents.length === 0
    ? `<tr><td style="padding:16px;color:#6b7280;font-size:13px;text-align:center;">No agent activity this week.</td></tr>`
    : topAgents.map((a, i) => {
        const errorRate = a.messages > 0 ? Math.round((a.errors / a.messages) * 100) : 0
        const fallbackRate = a.messages > 0 ? Math.round((a.fallbackCount / a.messages) * 100) : 0
        const needsAttention = errorRate > 5 || fallbackRate > 10
        return `
          <tr>
            <td style="padding:12px 14px;border-top:1px solid #e5e7eb;font-size:13px;">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
                <div>
                  <span style="color:#9ca3af;font-size:11px;font-weight:600;">#${i + 1}</span>
                  <strong style="color:#111827;margin-left:6px;">${escapeHtml(a.name)}</strong>
                  ${needsAttention ? '<span style="display:inline-block;margin-left:8px;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e;font-size:10px;font-weight:600;">Needs attention</span>' : ''}
                </div>
                <span style="color:#6b7280;font-size:12px;">${fmtNum(a.messages)} msg · ${fmtNum(a.appointments)} appt · $${a.estCost.toFixed(2)}</span>
              </div>
              ${a.fallbackCount > 0 ? `<div style="color:#92400e;font-size:11px;margin-top:6px;">Said "I don't know" ${a.fallbackCount} times</div>` : ''}
            </td>
          </tr>`
      }).join('')

  const agentsTable = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;margin-bottom:24px;">
      <tr>
        <th align="left" style="padding:10px 14px;background:#f9fafb;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;font-weight:600;">Agents this week</th>
      </tr>
      ${agentRows}
    </table>`

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:640px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:28px;border-top:4px solid #fa4d2e;">
              <div style="font-size:11px;color:#9ca3af;letter-spacing:0.5px;margin-bottom:6px;">📊 WEEKLY DIGEST · ${range}${deltaChip}</div>
              <h1 style="margin:0 0 6px;font-size:22px;color:#111827;font-weight:700;">${escapeHtml(workspaceName)} this week</h1>
              <p style="margin:0 0 22px;color:#4b5563;font-size:14px;">${greeting} here&rsquo;s how your agents performed.</p>

              ${totalsTable}
              ${agentsTable}

              <a href="${escapeHtml(dashUrl)}" style="display:inline-block;padding:11px 20px;background:#fa4d2e;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Open full digest in Voxility →</a>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">
              You&rsquo;re receiving this because you&rsquo;re a member of ${escapeHtml(workspaceName)} on Voxility.
              <a href="${escapeHtml(dashUrl)}" style="color:#9ca3af;">Manage digest preferences</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function renderDigestText(payload: DigestPayload, workspaceName: string): string {
  const t = payload.totals
  const lines = [
    `${workspaceName} weekly digest — ${fmtDate(payload.weekStart)} to ${fmtDate(payload.weekEnd)}`,
    '',
    `Messages:      ${fmtNum(t.messages)}${t.deltaVsLastWeek !== null ? ` (${t.deltaVsLastWeek >= 0 ? '+' : ''}${t.deltaVsLastWeek}% vs last week)` : ''}`,
    `Appointments:  ${fmtNum(t.appointments)}`,
    `Follow-ups:    ${fmtNum(t.followUpsSent)}`,
    `Est. cost:     $${t.estCost.toFixed(2)} (${(t.tokens / 1000).toFixed(0)}k tokens)`,
    '',
    'Top agents:',
    ...payload.agents.slice(0, 8).map((a, i) =>
      `  ${i + 1}. ${a.name} — ${a.messages} msg, ${a.appointments} appt, $${a.estCost.toFixed(2)}${a.fallbackCount > 0 ? ` (${a.fallbackCount} "I don't know" replies)` : ''}`
    ),
    '',
    '— Voxility',
  ]
  return lines.join('\n')
}

export interface SendDigestParams {
  to: string
  recipientName?: string | null
  workspaceId: string
  workspaceName: string
  payload: DigestPayload
}

export async function sendDigestEmail(p: SendDigestParams): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'RESEND_API_KEY not set' }
  }
  const from = process.env.NOTIFICATION_FROM_EMAIL || 'Voxility <notifications@voxility.app>'
  const html = renderDigestHtml(p.payload, {
    workspaceId: p.workspaceId,
    workspaceName: p.workspaceName,
    recipientName: p.recipientName ?? null,
    appUrl: process.env.APP_URL || '',
  })
  const text = renderDigestText(p.payload, p.workspaceName)
  const subject = renderDigestSubject(p.payload, p.workspaceName)

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [p.to], subject, html, text }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, reason: `Resend ${res.status}: ${body.slice(0, 200)}` }
  }
  return { ok: true }
}
