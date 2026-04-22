import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction, roleHas } from '@/lib/admin-auth'
import { applyLearning, retireLearning } from '@/lib/platform-learning'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Lifecycle endpoint for a single PlatformLearning. POST body is:
 *
 *   { action: "approve" | "reject" | "apply" | "retire", reason?: string,
 *     content?: string }  // `content` only used on approve to allow
 *                         // the admin to edit the wording before approval
 *
 * Illegal transitions return 400. 2FA gated at the admin layout, but
 * we re-check session here since this is a write endpoint.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  // Viewer-tier admins can browse /admin/learnings (read-only) but all
  // lifecycle actions — approve / reject / apply / retire — require
  // admin-tier at minimum. all_agents-scoped applies can affect every
  // customer on the platform; this is not a read-only operation.
  if (!roleHas(session.role, 'admin')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  let body: { action?: string; reason?: string; content?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const action = body.action
  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const learning = await db.platformLearning.findUnique({
    where: { id },
    select: { id: true, status: true, content: true },
  })
  if (!learning) {
    return NextResponse.json({ error: 'Learning not found' }, { status: 404 })
  }

  if (action === 'approve') {
    if (learning.status !== 'proposed') {
      return NextResponse.json(
        { error: `Can only approve proposed learnings (current: ${learning.status})` },
        { status: 400 },
      )
    }
    // Admin may have edited the wording before approval. Trim + cap
    // so we can't be fed a megabyte of text.
    const editedContent = typeof body.content === 'string' ? body.content.trim().slice(0, 4000) : null
    const updated = await db.platformLearning.update({
      where: { id },
      data: {
        status: 'approved',
        approvedByEmail: session.email,
        ...(editedContent && editedContent !== learning.content ? { content: editedContent } : {}),
      },
    })
    logAdminAction({
      admin: session,
      action: 'learning_approve',
      target: id,
      meta: { edited: editedContent !== null && editedContent !== learning.content },
    }).catch(() => {})
    return NextResponse.json({ ok: true, learning: updated })
  }

  if (action === 'reject') {
    if (!['proposed', 'approved'].includes(learning.status)) {
      return NextResponse.json(
        { error: `Can only reject proposed or approved learnings (current: ${learning.status})` },
        { status: 400 },
      )
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : null
    const updated = await db.platformLearning.update({
      where: { id },
      data: {
        status: 'rejected',
        rejectedByEmail: session.email,
        rejectedReason: reason,
      },
    })
    logAdminAction({
      admin: session,
      action: 'learning_reject',
      target: id,
      meta: { reason: reason ?? null },
    }).catch(() => {})
    return NextResponse.json({ ok: true, learning: updated })
  }

  if (action === 'apply') {
    const result = await applyLearning(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    logAdminAction({
      admin: session,
      action: 'learning_apply',
      target: id,
      meta: { agentId: result.agentId },
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  if (action === 'retire') {
    const result = await retireLearning(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    logAdminAction({
      admin: session,
      action: 'learning_retire',
      target: id,
    }).catch(() => {})
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
