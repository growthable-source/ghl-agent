/**
 * "Great feedback" email — when a visitor rates a live chat highly (CSAT ≥ the
 * good-rating threshold), the brand's portal admins get a short, branded
 * heads-up so wins are visible, with a link to their stats.
 *
 * Best-effort: every path swallows to a no-op. Recipients are the portal users
 * assigned to the conversation's brand (PortalUserBrand). Tickets have no
 * rating surface yet — when they gain one, call sendPositiveFeedbackEmail with
 * the ticket's brand + summary the same way.
 */

import { db } from '@/lib/db'
import { renderBrandedEmail, escapeHtml, paragraphs } from '@/lib/email-render'
import { sendEmail } from '@/lib/email-send'

function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXTAUTH_URL || 'https://app.xovera.io').replace(/\/$/, '')
}

/** Portal users who should hear about feedback for this brand. */
async function brandPortalRecipients(brandId: string): Promise<string[]> {
  const users = await db.portalUser.findMany({
    where: { isActive: true, acceptedAt: { not: null }, brandAssignments: { some: { brandId } } },
    select: { email: true },
  }).catch(() => [])
  return users.map(u => u.email).filter((e): e is string => !!e && e.includes('@'))
}

export async function sendPositiveFeedbackEmail(input: {
  brandId: string
  brandName: string | null
  /** e.g. "a live chat" or "ticket #123". */
  source: string
  who: string
  rating: number
  ratingMax?: number
  summary: string | null
  comment: string | null
}): Promise<{ sent: number }> {
  const emails = await brandPortalRecipients(input.brandId)
  if (emails.length === 0) return { sent: 0 }

  const max = input.ratingMax ?? 5
  const stars = '★'.repeat(Math.min(input.rating, max)) + '☆'.repeat(Math.max(0, max - input.rating))
  const brand = input.brandName || 'your brand'

  const { html, text } = renderBrandedEmail({
    title: 'Great feedback from Growthable',
    preheader: `${input.who} rated ${input.source} ${input.rating}/${max}`,
    intro: `${input.who} just left a ${input.rating}/${max} rating on ${input.source} with ${escapeHtml(brand)}.`,
    bodyHtml: paragraphs([
      { html: `<strong>Rating:</strong> ${stars} &nbsp;(${input.rating}/${max})` },
      input.summary ? { html: `<strong>What it was about</strong><br>${escapeHtml(input.summary).slice(0, 800)}` } : '',
      input.comment ? { html: `<strong>Their comment</strong><br>“${escapeHtml(input.comment).slice(0, 500)}”` } : '',
    ].filter(Boolean) as Array<string | { html: string }>),
    cta: { label: 'View your stats', url: `${appUrl()}/portal/reports` },
  })

  // Send individually so portal admins don't see each other's addresses.
  let sent = 0
  await Promise.all(emails.map(async to => {
    const id = await sendEmail(
      { to, subject: 'Great feedback from Growthable', html, text, from: process.env.PORTAL_FROM_EMAIL || undefined, context: 'positive-feedback' },
    ).catch(() => null)
    if (id) sent++
  }))
  return { sent }
}

/**
 * Report to the brand's portal admins that a visitor was blocked for conduct.
 * Best-effort. `blockedBy` is the person who took the action.
 */
export async function sendConductBlockEmail(input: {
  brandId: string
  brandName: string | null
  visitorLabel: string
  reason: string | null
  blockedBy: string
  excerpt: string | null
}): Promise<{ sent: number }> {
  const emails = await brandPortalRecipients(input.brandId)
  if (emails.length === 0) return { sent: 0 }

  const brand = input.brandName || 'your brand'
  const { html, text } = renderBrandedEmail({
    title: 'A visitor was blocked for conduct',
    preheader: `${input.visitorLabel} was blocked on ${brand}`,
    intro: `${escapeHtml(input.blockedBy)} ended and blocked a live chat with ${escapeHtml(brand)} because of the visitor's conduct.`,
    bodyHtml: paragraphs([
      { html: `<strong>Visitor:</strong> ${escapeHtml(input.visitorLabel)}` },
      input.reason ? { html: `<strong>Reason:</strong> ${escapeHtml(input.reason)}` } : '',
      input.excerpt ? { html: `<strong>What they said</strong><br>“${escapeHtml(input.excerpt).slice(0, 500)}”` } : '',
      `The visitor can no longer send messages on this widget. You can reverse this from the conversation if it was a mistake.`,
    ].filter(Boolean) as Array<string | { html: string }>),
    cta: { label: 'Review conversations', url: `${appUrl()}/portal/conversations` },
  })

  let sent = 0
  await Promise.all(emails.map(async to => {
    const id = await sendEmail(
      { to, subject: `Visitor blocked for conduct — ${brand}`, html, text, from: process.env.PORTAL_FROM_EMAIL || undefined, context: 'conduct-block' },
    ).catch(() => null)
    if (id) sent++
  }))
  return { sent }
}

/** Load a rated conversation and email the brand's portal admins. */
export async function emailPortalPositiveChatFeedback(
  conversationId: string,
  rating: number,
  comment: string | null,
): Promise<void> {
  try {
    const convo = await db.widgetConversation.findUnique({
      where: { id: conversationId },
      select: {
        aiSummary: true,
        widget: { select: { brandId: true, brand: { select: { name: true } } } },
        visitor: { select: { name: true, email: true } },
        messages: {
          where: { role: { in: ['visitor', 'user', 'contact'] } },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { content: true },
        },
      },
    })
    const brandId = convo?.widget?.brandId
    if (!brandId) return // no brand → no portal to notify

    await sendPositiveFeedbackEmail({
      brandId,
      brandName: convo!.widget?.brand?.name ?? null,
      source: 'a live chat',
      who: convo!.visitor?.name || convo!.visitor?.email || 'A customer',
      rating,
      summary: (convo!.aiSummary || convo!.messages[0]?.content || '').trim() || null,
      comment,
    })
  } catch {
    /* best-effort — never affects the rating submission */
  }
}
