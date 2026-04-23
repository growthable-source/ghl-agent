import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceRole } from '@/lib/require-workspace-role'
import { reviewPlaygroundFeedback } from '@/lib/feedback-review'

export const dynamic = 'force-dynamic'
// The feedback review invokes Claude once + writes two DB rows. 45s
// is a generous upper bound; realistic p95 is under 15s.
export const maxDuration = 60

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Playground thumbs-up / thumbs-down feedback on a specific agent reply.
 *
 * Thumbs UP is a no-op for now — we acknowledge receipt but don't write
 * anything durable. It's a signal we may want later for "positive
 * training examples" or simply analytics; for now, the user just sees
 * "thanks" and moves on.
 *
 * Thumbs DOWN triggers reviewPlaygroundFeedback() which calls Claude
 * with the conversation + narrative, optionally produces a
 * this_agent learning, auto-applies it. Response surfaces which of
 * three outcomes happened so the UI can show the right state:
 *   - applied: a learning was generated and applied to the agent
 *   - skipped: the reviewer decided no change was warranted
 *   - error:   something went wrong (displayed as inline error)
 *
 * Role gate: workspace "admin" or "owner". A member poking the
 * playground can see the buttons but their feedback can't mutate the
 * agent prompt — that's aligned with the simulation retire gate.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceRole(workspaceId, 'admin')
  if (access instanceof NextResponse) return access
  const { session } = access

  const body = await req.json().catch(() => null) as any
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : ''
  const rating = body.rating === 'up' || body.rating === 'down' ? body.rating : ''
  const conversation = Array.isArray(body.conversation) ? body.conversation : null
  const flaggedReplyIndex = typeof body.flaggedReplyIndex === 'number' ? body.flaggedReplyIndex : -1
  const narrative = typeof body.narrative === 'string' ? body.narrative : ''

  if (!agentId || !rating) {
    return NextResponse.json({ error: 'agentId and rating required' }, { status: 400 })
  }

  // Confirm the agent is actually in this workspace — prevents sending
  // feedback "on behalf of" another workspace's agent by spoofing ID.
  const agent = await db.agent.findFirst({
    where: {
      id: agentId,
      OR: [
        { workspaceId },
        { location: { workspaceId } },
      ],
    },
    select: { id: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found in this workspace' }, { status: 404 })
  }

  if (rating === 'up') {
    // Future: log a positive-signal row for analytics. For now, the
    // reply is already good — nothing to propose. Return quickly.
    return NextResponse.json({ ok: true, outcome: 'thanks' })
  }

  // Thumbs DOWN from here on.
  if (!conversation || conversation.length === 0) {
    return NextResponse.json({ error: 'conversation required for thumbs-down feedback' }, { status: 400 })
  }
  if (flaggedReplyIndex < 0 || flaggedReplyIndex >= conversation.length) {
    return NextResponse.json({ error: 'flaggedReplyIndex out of range' }, { status: 400 })
  }
  // Narrative is optional — we invite one but don't require it. An
  // empty narrative just gives the reviewer less signal, which usually
  // lands as "declined to propose".
  const trimmedNarrative = narrative.trim().slice(0, 1000)

  // Normalise conversation turns — caller may have sent richer shapes
  // (tool traces etc). We only need role + content.
  const cleaned = conversation.map((t: any) => ({
    role: t?.role === 'user' ? 'user' as const : 'agent' as const,
    content: typeof t?.content === 'string' ? t.content : '',
  })).filter((t: { content: string }) => t.content)

  const result = await reviewPlaygroundFeedback({
    agentId,
    conversation: cleaned,
    flaggedReplyIndex,
    narrative: trimmedNarrative,
    submittedByEmail: session.user?.email ?? 'unknown@playground',
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    ok: true,
    outcome: result.learningId ? 'applied' : 'skipped',
    learningId: result.learningId,
  })
}
