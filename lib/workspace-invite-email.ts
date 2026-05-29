/**
 * Workspace invite email via the shared branded wrapper.
 *
 * Pre-refactor this file shipped its own ~50 lines of inline HTML +
 * its own escapeHtml + its own Resend POST. Now it just composes a
 * BrandedEmail and hands off to sendEmail() — the wrapper supplies
 * the Voxility header bar, severity-aware accent (info for invites),
 * the CTA button shape, and the footer.
 */

import { escapeHtml, paragraphs, renderBrandedEmail } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

interface InvitePayload {
  to: string
  workspaceName: string
  inviterName: string | null
  role: string
  inviteUrl: string
  /** Retained for back-compat; the branded wrapper sets its own accent. */
  primaryColor?: string | null
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'an Owner',
  admin: 'an Admin',
  member: 'a Member',
  viewer: 'a Viewer',
}

export async function sendWorkspaceInviteEmail(p: InvitePayload): Promise<void> {
  const inviterLine = p.inviterName
    ? `${p.inviterName} invited you to ${p.workspaceName} on Voxility`
    : `You've been invited to ${p.workspaceName} on Voxility`
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
    subject: `You're invited to ${p.workspaceName} on Voxility`,
    html,
    text,
    context: 'WorkspaceInvite',
  })
}
