/**
 * Portal-invite email dispatch via Resend (https://resend.com).
 *
 * Kept separate from lib/notifications.ts so the portal product can
 * evolve its email surface (white-labelled per portal, branded
 * footer, etc.) without entangling the workspace notification pipeline.
 *
 * Required env:
 *   - RESEND_API_KEY
 *   - NOTIFICATION_FROM_EMAIL (or PORTAL_FROM_EMAIL override)
 *   - NEXT_PUBLIC_APP_URL (e.g. https://voxility.app) — used to build
 *     the absolute invite link. Falls back to a relative path so dev
 *     still works.
 */

interface InvitePayload {
  to: string
  portalName: string
  inviteUrl: string
  // Optional accent color so the email picks up the portal's brand.
  primaryColor?: string | null
}

export async function sendPortalInviteEmail(p: InvitePayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // In dev / preview you might not have Resend wired up. Don't crash
    // the invite flow — log so the operator can copy the link from the
    // /admin UI instead.
    console.warn('[PortalInvite] RESEND_API_KEY not set — email skipped:', p.to)
    return
  }

  const from = process.env.PORTAL_FROM_EMAIL
    ?? process.env.NOTIFICATION_FROM_EMAIL
    ?? 'Voxility <notifications@voxility.app>'
  const accent = p.primaryColor || '#fa4d2e'
  const subject = `You're invited to ${p.portalName}`

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${accent};">Customer Portal</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#111;">You're invited to ${escapeHtml(p.portalName)}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#3f3f46;">You've been invited to access the customer portal where you can review conversations, transcripts, and CSAT data for the brands assigned to you.</p>
          <p style="margin:0 0 28px;">
            <a href="${p.inviteUrl}" style="display:inline-block;padding:12px 22px;background:${accent};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Accept invitation</a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#71717a;">Or copy this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#52525b;word-break:break-all;"><a href="${p.inviteUrl}" style="color:${accent};">${escapeHtml(p.inviteUrl)}</a></p>
          <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa;">This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `You're invited to ${p.portalName}.\n\nAccept your invitation: ${p.inviteUrl}\n\nThis invitation expires in 7 days.`

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
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`)
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
