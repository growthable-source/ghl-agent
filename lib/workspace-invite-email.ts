/**
 * Workspace invite email via the shared branded wrapper.
 *
 * Pre-refactor this file shipped its own ~50 lines of inline HTML +
 * its own escapeHtml + its own Resend POST. Now it just composes a
 * BrandedEmail and hands off to sendEmail() — the wrapper supplies
 * the Xovera header bar, severity-aware accent (info for invites),
 * the CTA button shape, and the footer.
 */

import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'
import { brandedFromAddress } from '@/lib/whitelabel/login-code'

interface InvitePayload {
  to: string
  workspaceName: string
  inviterName: string | null
  role: string
  inviteUrl: string
  /** Retained for back-compat; the branded wrapper sets its own accent. */
  primaryColor?: string | null
  /** White-label workspace (lib/whitelabel/invite.ts): sent under the
   *  customer's brand, never mentions us, and the link is their sign-in. */
  brand?: { name: string; accent: string | null } | null
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'an Owner',
  admin: 'an Admin',
  member: 'a Member',
  viewer: 'a Viewer',
  agent: 'a Support Agent',
}

export async function sendWorkspaceInviteEmail(p: InvitePayload): Promise<void> {
  if (p.brand) return sendWhitelabelInvite(p, p.brand)
  const inviterLine = p.inviterName
    ? `${p.inviterName} invited you to ${p.workspaceName} on Xovera`
    : `You've been invited to ${p.workspaceName} on Xovera`
  const roleLabel = ROLE_LABELS[p.role] || `a ${p.role}`

  const { html, text } = renderBrandedEmail({
    title: inviterLine,
    preheader: `You're being added as ${roleLabel} on ${p.workspaceName}.`,
    intro: `You're being added as ${roleLabel}. Accept the invitation to collaborate in the inbox, manage agents, and work alongside your team.`,
    bodyHtml: paragraphs([
      {
        html: `If the button doesn't open, paste this link into your browser:<br>
               <a href="${escapeHtml(p.inviteUrl)}" style="color:#fa4d2e;word-break:break-all;">${escapeHtml(p.inviteUrl)}</a>`,
      },
      `This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.`,
    ]),
    cta: { label: 'Accept invitation', url: p.inviteUrl },
  })

  await sendEmail({
    to: p.to,
    subject: `You're invited to ${p.workspaceName} on Xovera`,
    html,
    text,
    context: 'WorkspaceInvite',
  })
}

async function sendWhitelabelInvite(p: InvitePayload, brand: { name: string; accent: string | null }): Promise<void> {
  const roleLabel = ROLE_LABELS[p.role] || `a ${p.role}`
  const title = p.inviterName
    ? `${p.inviterName} invited you to join ${brand.name}`
    : `You've been invited to join ${brand.name}`
  const intro = p.role === 'agent'
    ? `You're being added as ${roleLabel} to answer live chats and work tickets.`
    : `You're being added as ${roleLabel}.`
  const { html, text } = renderBrandedEmail({
    title,
    preheader: intro,
    intro,
    bodyHtml: paragraphs([
      `Sign in with this email address — we'll email you a one-time code, no password needed.`,
      {
        html: `If the button doesn't open, paste this link into your browser:<br>
               <a href="${escapeHtml(p.inviteUrl)}" style="word-break:break-all;">${escapeHtml(p.inviteUrl)}</a>`,
      },
      `This invitation expires in 7 days. If you weren't expecting it, you can safely ignore this email.`,
    ]),
    cta: { label: 'Sign in', url: p.inviteUrl },
    brand,
  })
  await sendEmail({
    to: p.to,
    subject: title,
    html,
    text,
    from: brandedFromAddress(brand.name, process.env.NOTIFICATION_FROM_EMAIL || 'notifications@xovera.io'),
    context: 'WorkspaceInvite',
  })
}
