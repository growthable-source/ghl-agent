import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminActionAfter, roleHas } from '@/lib/admin-auth'
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
    logAdminActionAfter({
      admin: session,
      action: 'learning_approve',
      target: id,
      meta: { edited: editedContent !== null && editedContent !== learning.content },
    })
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
    logAdminActionAfter({
      admin: session,
      action: 'learning_reject',
      target: id,
      meta: { reason: reason ?? null },
    })
    return NextResponse.json({ ok: true, learning: updated })
  }

  if (action === 'apply') {
    const result = await applyLearning(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    logAdminActionAfter({
      admin: session,
      action: 'learning_apply',
      target: id,
      meta: { agentId: result.agentId },
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'retire') {
    const result = await retireLearning(id)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }
    logAdminActionAfter({
      admin: session,
      action: 'learning_retire',
      target: id,
    })
    return NextResponse.json({ ok: true })
  }

  if (action === 'promote') {
    // Promote a successful this_agent learning to scope=all_agents.
    // Creates a brand-new PlatformLearning row (status=proposed,
    // scope=all_agents) with content copied from the source. The super
    // admin then approves + applies it through the normal queue — the
    // copy is NOT auto-applied because the blast radius is every
    // workspace on the platform.
    //
    // Traceability: stash the source id in rationale so approvers can
    // jump back to the original conversation. Proper sourceLearningId
    // column is a future nice-to-have.
    const source = await db.platformLearning.findUnique({
      where: { id },
      select: {
        id: true, scope: true, type: true, title: true, content: true,
        rationale: true, sourceReviewId: true,
      },
    })
    if (!source) {
      return NextResponse.json({ error: 'Source learning not found' }, { status: 404 })
    }
    if (source.scope !== 'this_agent') {
      return NextResponse.json(
        { error: `Can only promote this_agent learnings (current: ${source.scope})` },
        { status: 400 },
      )
    }
    const promotedRationale = [
      source.rationale?.trim(),
      `Promoted from learning ${source.id} (originally scoped to one agent).`,
    ].filter(Boolean).join(' ')
    const created = await db.platformLearning.create({
      data: {
        sourceReviewId: source.sourceReviewId,
        scope: 'all_agents',
        workspaceId: null,
        agentId: null,
        type: source.type,
        title: source.title,
        content: source.content,
        rationale: promotedRationale,
        status: 'proposed',
        proposedByEmail: session.email,
      },
      select: { id: true },
    })
    logAdminActionAfter({
      admin: session,
      action: 'learning_promote',
      target: id,
      meta: { promotedLearningId: created.id },
    })
    return NextResponse.json({ ok: true, promotedLearningId: created.id })
  }

  return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
}
