/**
 * Voice-quota warning email. Fires once per billing period when a
 * workspace crosses 80% of its included voice minutes.
 *
 * Uses the shared branded wrapper at warning severity (same colour-
 * coded top bar as the trial-ending alert). CTA → workspace's
 * billing settings page.
 *
 * Recipients: every Owner of the workspace (same resolution as
 * lib/billing-alert-email.ts — falls back to the earliest-joined
 * member when no explicit Owner exists).
 */

import { db } from '@/lib/db'
import { renderBrandedEmail, paragraphs } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

interface VoiceQuotaWarningContext {
  workspaceId: string
  workspaceName: string
  usedMinutes: number
  limitMinutes: number
  planLabel: string
}

async function getBillingRecipients(workspaceId: string): Promise<string[]> {
  try {
    const owners = await db.workspaceMember.findMany({
      where: { workspaceId, role: 'owner' },
      select: { user: { select: { email: true } } },
    })
    const ownerEmails = owners.map(o => o.user?.email).filter((e): e is string => !!e)
    if (ownerEmails.length > 0) return Array.from(new Set(ownerEmails))

    const members = await db.workspaceMember.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'asc' },
      take: 1,
      select: { user: { select: { email: true } } },
    })
    return members.map(m => m.user?.email).filter((e): e is string => !!e)
  } catch (err: any) {
    console.warn(`[VoiceQuota] Recipient lookup failed for workspace ${workspaceId}:`, err?.message)
    return []
  }
}

export async function sendVoiceQuotaWarningEmail(ctx: VoiceQuotaWarningContext): Promise<void> {
  const recipients = await getBillingRecipients(ctx.workspaceId)
  if (recipients.length === 0) {
    console.warn(`[VoiceQuota] No recipients for warning on workspace ${ctx.workspaceId}`)
    return
  }

  const billingUrl = `${process.env.APP_URL || ''}/dashboard/${ctx.workspaceId}/settings/billing`
  const remaining = Math.max(0, ctx.limitMinutes - ctx.usedMinutes)
  const pct = Math.min(100, Math.round((ctx.usedMinutes / Math.max(1, ctx.limitMinutes)) * 100))

  const { html, text } = renderBrandedEmail({
    title: `${ctx.workspaceName} is at ${pct}% of its voice minutes`,
    preheader: `${remaining} minutes left for this billing period.`,
    severity: 'warning',
    intro: `Heads-up — ${ctx.workspaceName} has used ${ctx.usedMinutes} of ${ctx.limitMinutes} included voice minutes (${pct}%) for this billing period. You have about ${remaining} minutes left before calls start being blocked.`,
    bodyHtml: paragraphs([
      `Your current plan is <strong>${ctx.planLabel}</strong>. Once the included minutes are used up, new outbound and inbound voice calls will be blocked until the next billing period or an upgrade.`,
      `If your call volume has grown, upgrading now keeps your agents available without any interruption. Existing agents, voices, and configuration carry over to the new plan automatically.`,
    ]),
    cta: { label: 'Upgrade plan', url: billingUrl },
    manageNotificationsUrl: `${process.env.APP_URL || ''}/dashboard`,
  })

  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: `${ctx.workspaceName} is at ${pct}% of its voice minutes`, html, text, context: 'VoiceQuotaWarning' })
    } catch (err: any) {
      console.warn(`[VoiceQuota] Warning send to ${to} failed:`, err?.message)
    }
  }
}
