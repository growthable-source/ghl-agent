/**
 * Workspace invite email via Resend.
 *
 * Mirrors lib/portal-email.ts but with workspace-team copy + role
 * context. The accept link drops them at /invite/<token> where the
 * accept flow gates on email match + signs them up if needed.
 *
 * Falls through silently when RESEND_API_KEY is unset so dev still
 * works — the operator can copy the link from the members page.
 */

interface InvitePayload {
  to: string
  workspaceName: string
  inviterName: string | null
  role: string
  inviteUrl: string
  primaryColor?: string | null
}

export async function sendWorkspaceInviteEmail(p: InvitePayload): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[WorkspaceInvite] RESEND_API_KEY not set — email skipped:', p.to)
    return
  }

  const from = process.env.NOTIFICATION_FROM_EMAIL
    ?? 'Voxility <notifications@voxility.app>'
  const accent = p.primaryColor || '#fa4d2e'
  const inviterLine = p.inviterName
    ? `${escapeHtml(p.inviterName)} invited you`
    : 'You’ve been invited'
  const subject = `You're invited to ${p.workspaceName} on Voxility`

  const roleCopy: Record<string, string> = {
    owner: 'as an Owner',
    admin: 'as an Admin',
    member: 'as a Member',
    viewer: 'as a Viewer',
  }
  const roleLabel = roleCopy[p.role] || `as a ${p.role}`

  const html = `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:520px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">
        <tr><td style="padding:28px 32px 0;">
          <p style="margin:0 0 4px;font-size:11px;font-weight:600;letter-spacing:1px;text-transform:uppercase;color:${accent};">Workspace invitation</p>
          <h1 style="margin:0 0 16px;font-size:22px;color:#111;">${inviterLine} to ${escapeHtml(p.workspaceName)}</h1>
          <p style="margin:0 0 24px;font-size:14px;line-height:1.55;color:#3f3f46;">You're being added ${escapeHtml(roleLabel)}. Accept the invitation to start collaborating in the inbox, manage agents, and work alongside your team.</p>
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

  const text = `${inviterLine} to ${p.workspaceName} on Voxility, ${roleLabel}.\n\nAccept your invitation: ${p.inviteUrl}\n\nThis invitation expires in 7 days.`

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
