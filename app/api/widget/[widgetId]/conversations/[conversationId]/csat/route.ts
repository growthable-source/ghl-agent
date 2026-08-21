import { NextRequest, NextResponse, after } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { isMissingColumn } from '@/lib/migration-error'
import { stageChatCsatLearningFromConversation } from '@/lib/tickets/brand-knowledge'
import { emailPortalPositiveChatFeedback } from '@/lib/portal/feedback-email'

// A rating this high or above counts as positive: it feeds agent learning AND
// triggers a "great feedback" email to the brand's portal admins. Ratings are
// 1–5 integers, so this is the practical form of the "3.5 or more" cutoff.
// Lower ratings train nothing and send no email.
const CSAT_GOOD_RATING = 4

type Params = { params: Promise<{ widgetId: string; conversationId: string }> }

/**
 * POST /api/widget/:widgetId/conversations/:conversationId/csat
 * Body: { rating: 1|2|3|4|5, comment?: string }
 *
 * Visitor satisfaction. One row per conversation — re-submitting
 * overwrites the prior rating.
 */
export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: widgetCorsHeaders(req.headers.get('origin')) })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId, conversationId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const rating = Number(body.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be 1-5' }, { status: 400, headers })
  }
  const comment = typeof body.comment === 'string' ? body.comment.slice(0, 500) : null

  // Verify conversation belongs to widget
  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widgetId },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Conversation not found' }, { status: 404, headers })

  try {
    await db.widgetConversation.update({
      where: { id: conversationId },
      data: { csatRating: rating, csatComment: comment, csatSubmittedAt: new Date() },
    })
  } catch (err: any) {
    if (isMissingColumn(err)) {
      return NextResponse.json({
        error: "CSAT columns aren't migrated yet. Run prisma/migrations-legacy/manual_widget_csat.sql.",
        code: 'MIGRATION_PENDING',
      }, { status: 503, headers })
    }
    return NextResponse.json({ error: err.message || 'Could not save rating' }, { status: 500, headers })
  }

  // A well-rated conversation (a) feeds the brand agent — distilled into a Q&A
  // staged for review — and (b) emails the brand's portal admins a "great
  // feedback" heads-up. Wrapped in after() so Vercel keeps the runtime alive
  // past the JSON response — bare fire-and-forget promises (Haiku call, DB
  // writes, email) are killed when the function suspends. Never delays or
  // fails the rating.
  if (rating >= CSAT_GOOD_RATING) {
    after(async () => {
      await stageChatCsatLearningFromConversation(conversationId).catch(() => {})
      await emailPortalPositiveChatFeedback(conversationId, rating, comment).catch(() => {})
    })
  }

  return NextResponse.json({ ok: true }, { headers })
}
