/**
 * Send a workspace-invite email via Resend.
 *
 * Mirrors the Resend setup in lib/notifications.ts and lib/digest-email.ts.
 * Required env:
 *   RESEND_API_KEY
 *   NOTIFICATION_FROM_EMAIL  (defaults to "Voxility <notifications@voxility.app>")
 *   APP_URL                  (used for the "Accept invite" CTA)
 *
 * Sign-in itself accepts the invite (see lib/auth.ts → events.signIn), so the
 * email simply links the recipient to /login with a redirect back to the
 * workspace dashboard.
 */

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]!))
}

export interface SendInviteEmailParams {
  to: string
  workspaceId: string
  workspaceName: string
  inviterName?: string | null
  inviterEmail?: string | null
  role: string
  expiresAt: Date
}

export function renderInviteSubject(p: Pick<SendInviteEmailParams, 'workspaceName' | 'inviterName'>): string {
  const who = p.inviterName?.trim() || 'Someone'
  return `${who} invited you to ${p.workspaceName} on Voxility`
}

export function renderInviteHtml(p: SendInviteEmailParams, appUrl: string): string {
  const acceptUrl = `${appUrl.replace(/\/$/, '')}/login?callbackUrl=${encodeURIComponent(`/dashboard/${p.workspaceId}`)}`
  const inviter = p.inviterName?.trim() || p.inviterEmail || 'A teammate'
  const expires = p.expiresAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const roleLabel = p.role === 'admin' ? 'an admin' : 'a member'

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
          <tr>
            <td style="padding:28px;border-top:4px solid #fa4d2e;">
              <h1 style="margin:0 0 8px;font-size:20px;color:#111827;line-height:1.3;font-weight:600;">You&rsquo;re invited to ${escapeHtml(p.workspaceName)}</h1>
              <p style="margin:0 0 20px;color:#4b5563;font-size:14px;line-height:1.6;">
                ${escapeHtml(inviter)} invited you to join <strong>${escapeHtml(p.workspaceName)}</strong> as ${roleLabel} on Voxility.
              </p>
              <a href="${escapeHtml(acceptUrl)}" style="display:inline-block;padding:11px 20px;background:#fa4d2e;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">Accept invite</a>
              <p style="margin:20px 0 0;color:#6b7280;font-size:12px;line-height:1.6;">
                Sign in with this email address (${escapeHtml(p.to)}) to accept. The invite expires on ${expires}.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;line-height:1.5;">
              If you weren&rsquo;t expecting this invite, you can safely ignore this email.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function renderInviteText(p: SendInviteEmailParams, appUrl: string): string {
  const acceptUrl = `${appUrl.replace(/\/$/, '')}/login?callbackUrl=${encodeURIComponent(`/dashboard/${p.workspaceId}`)}`
  const inviter = p.inviterName?.trim() || p.inviterEmail || 'A teammate'
  const roleLabel = p.role === 'admin' ? 'an admin' : 'a member'
  return [
    `${inviter} invited you to join ${p.workspaceName} as ${roleLabel} on Voxility.`,
    '',
    `Accept: ${acceptUrl}`,
    '',
    `Sign in with ${p.to} to accept. Invite expires ${p.expiresAt.toISOString().slice(0, 10)}.`,
    '',
    '— Voxility',
  ].join('\n')
}

export async function sendInviteEmail(p: SendInviteEmailParams): Promise<{ ok: boolean; reason?: string }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return { ok: false, reason: 'RESEND_API_KEY not set' }
  }
  const from = process.env.NOTIFICATION_FROM_EMAIL || 'Voxility <notifications@voxility.app>'
  const appUrl = process.env.APP_URL || ''

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [p.to],
      subject: renderInviteSubject(p),
      html: renderInviteHtml(p, appUrl),
      text: renderInviteText(p, appUrl),
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, reason: `Resend ${res.status}: ${body.slice(0, 200)}` }
  }
  return { ok: true }
}
