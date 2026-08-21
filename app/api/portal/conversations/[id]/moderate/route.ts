import { NextRequest, NextResponse, after } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'
import { sendConductBlockEmail } from '@/lib/portal/feedback-email'
import { isCrossSiteRequest } from '@/lib/csrf'

type Params = { params: Promise<{ id: string }> }

/**
 * POST { action: 'end' | 'block' | 'unblock', reason? } — portal moderation
 * for a live chat. Protects the team from abusive visitors:
 *   end     — mark the conversation ended (visitor can still start a new one)
 *   block   — end it AND block the visitor for conduct (their messages are
 *             refused going forward) + email the brand's portal admins
 *   unblock — reverse a block (a mistake / de-escalated)
 *
 * Only ever human-initiated — sentiment scoring never blocks anyone itself.
 */
export async function POST(req: NextRequest, { params }: Params) {
  // The portal embed cookie is SameSite=None, so guard this destructive
  // (block/unblock/end) route against cross-site forgery.
  if (isCrossSiteRequest(req)) {
    return NextResponse.json({ error: 'Cross-site request refused' }, { status: 403 })
  }
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params

  const body = await req.json().catch(() => ({}))
  const action = ['end', 'block', 'unblock'].includes(body.action) ? body.action as 'end' | 'block' | 'unblock' : null
  if (!action) return NextResponse.json({ error: 'action must be end, block or unblock' }, { status: 400 })

  const convo = await db.widgetConversation.findUnique({
    where: { id },
    select: {
      id: true, visitorId: true, sentimentReason: true,
      widget: { select: { brandId: true, brand: { select: { name: true } } } },
      visitor: { select: { name: true, email: true } },
      messages: {
        where: { role: { in: ['visitor', 'user', 'contact'] } },
        orderBy: { createdAt: 'desc' }, take: 1, select: { content: true },
      },
    },
  }).catch(() => null)
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const brandId = convo.widget?.brandId
  if (!brandId || !session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const now = new Date()

  if (action === 'unblock') {
    if (convo.visitorId) {
      await db.widgetVisitor.update({
        where: { id: convo.visitorId },
        data: { blockedAt: null, blockReason: null, blockedByEmail: null },
      }).catch(() => {})
    }
    return NextResponse.json({ ok: true, status: 'unblocked' })
  }

  // Both end and block close the conversation.
  await db.widgetConversation.update({ where: { id }, data: { status: 'ended' } }).catch(() => {})

  if (action === 'end') return NextResponse.json({ ok: true, status: 'ended' })

  // ── block ───────────────────────────────────────────────────────────
  const reason = typeof body.reason === 'string' && body.reason.trim()
    ? body.reason.trim().slice(0, 300)
    : (convo.sentimentReason || 'Abusive or offensive conduct')
  const blockedBy = session.name || session.email || 'A reviewer'

  if (convo.visitorId) {
    await db.widgetVisitor.update({
      where: { id: convo.visitorId },
      data: { blockedAt: now, blockReason: reason, blockedByEmail: session.email },
    }).catch(() => {})
  }

  const visitorLabel = convo.visitor?.name || convo.visitor?.email || 'Anonymous visitor'
  after(async () => {
    await sendConductBlockEmail({
      brandId,
      brandName: convo.widget?.brand?.name ?? null,
      visitorLabel,
      reason,
      blockedBy,
      excerpt: convo.messages[0]?.content ?? null,
    }).catch(() => {})
  })

  return NextResponse.json({ ok: true, status: 'blocked' })
}
