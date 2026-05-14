/**
 * Magic link email for resuming a widget chat from a new device / cleared cookies.
 *
 * Sent by the /visitor identify endpoint whenever a fresh cookieId hands
 * us an email that already maps to a different WidgetVisitor on this
 * widget WITH a live conversation. The visitor clicks the link, the
 * recover endpoint re-points the original visitor row at the new
 * cookieId, and they pick up where they left off.
 *
 * Single-factor by design — email ownership is proved by the click.
 * Tokens expire in 30 minutes and are single-use.
 */

interface RecoveryPayload {
  to: string
  visitorName: string | null
  widgetName: string
  recoverUrl: string
  primaryColor?: string | null
}

export async function sendVisitorRecoveryEmail(p: RecoveryPayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    // No mailer wired up — log so the operator can copy the link
    // manually from the recovery token table if needed.
    console.warn('[WidgetRecovery] RESEND_API_KEY not set — email skipped:', p.to)
    return
  }

  const from = process.env.NOTIFICATION_FROM_EMAIL
    ?? 'Voxility <notifications@voxility.app>'
  const accent = p.primaryColor || '#fa4d2e'
  const greeting = p.visitorName ? `Hi ${escapeHtml(p.visitorName)},` : 'Hi there,'
  const subject = `Resume your chat with ${p.widgetName}`

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${accent};">Resume your chat</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#111;">${greeting}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#3f3f46;">It looks like you opened our chat from a new device or browser. Click below to pick up your conversation with ${escapeHtml(p.widgetName)} exactly where you left off.</p>
          <p style="margin:0 0 28px;">
            <a href="${p.recoverUrl}" style="display:inline-block;padding:12px 22px;background:${accent};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Resume chat</a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;color:#71717a;">Or copy this link into your browser:</p>
          <p style="margin:0 0 24px;font-size:12px;color:#52525b;word-break:break-all;"><a href="${p.recoverUrl}" style="color:${accent};">${escapeHtml(p.recoverUrl)}</a></p>
          <p style="margin:0 0 24px;font-size:12px;color:#a1a1aa;">This link expires in 30 minutes. If you didn't request it, you can safely ignore this email — nothing changes.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  const text = `Resume your chat with ${p.widgetName}: ${p.recoverUrl}\n\nThis link expires in 30 minutes.`

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
