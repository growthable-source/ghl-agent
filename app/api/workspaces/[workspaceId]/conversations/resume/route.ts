import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { audit } from '@/lib/audit'

/**
 * Resume a paused conversation and hand it back to the agent.
 *
 * Works for all pause paths:
 *   - Stop conditions (SENTIMENT, KEYWORD, APPOINTMENT_BOOKED, etc.)
 *   - transfer_to_human tool calls from the agent itself
 *   - Explicit human takeover
 *
 * If a LiveTakeover record exists, it's ended. If the operator provided
 * a note, it's stashed into ContactMemory under `handoff_context` so the
 * agent sees it on its next turn ("A human just handed this back to you
 * with this context: <note>"). The existing contact-memory injection
 * block surfaces this automatically — no separate prompt wiring needed.
 *
 * Body: { agentId, contactId, note? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const agentId = String(body?.agentId ?? '').trim()
  const contactId = String(body?.contactId ?? '').trim()
  const note = typeof body?.note === 'string' ? body.note.trim() : ''
  if (!agentId || !contactId) {
    return NextResponse.json({ error: 'agentId and contactId required' }, { status: 400 })
  }

  // Verify the agent is in this workspace before mutating anything.
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, locationId: true },
  })
  if (!agent) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

  const now = new Date()

  // 1. Flip the conversation state back to ACTIVE and clear pauseReason.
  //    updateMany so we don't 404 when there's no existing record (rare
  //    but possible if the record got pruned).
  await db.conversationStateRecord.updateMany({
    where: { agentId, contactId },
    data: { state: 'ACTIVE', pauseReason: null, resumedAt: now },
  })

  // 2. End any open LiveTakeover for this contact+agent so the human's
  //    ownership is released. Silent no-op if there wasn't one.
  try {
    await db.liveTakeover.updateMany({
      where: { agentId, contactId, endedAt: null },
      data: { endedAt: now },
    })
  } catch {
    // LiveTakeover table may not exist on older migrations — non-fatal.
  }

  // 3. If the operator left a handoff note, drop it into ContactMemory
  //    so the next agent turn sees it. Keep the most recent note only —
  //    categories JSON is a flat key/value, we don't want this to grow.
  if (note) {
    try {
      const existing = await db.contactMemory.findUnique({
        where: { agentId_contactId: { agentId, contactId } },
        select: { summary: true, categories: true },
      })
      const nextCategories = {
        ...((existing?.categories as Record<string, string> | null) ?? {}),
        handoff_context: `A human just handed this conversation back to you. Their note: "${note}". Treat this as essential context for your next reply; do not re-open topics the human has already addressed.`,
      }
      await db.contactMemory.upsert({
        where: { agentId_contactId: { agentId, contactId } },
        create: {
          agentId,
          contactId,
          locationId: agent.locationId,
          summary: existing?.summary ?? null,
          categories: nextCategories,
        },
        update: { categories: nextCategories },
      })
    } catch (err) {
      // Memory write is best-effort — missing table on older DBs
      // shouldn't block the resume.
      console.warn('[resume] writing handoff_context failed:', err)
    }
  }

  await audit({
    workspaceId,
    actorId: access.session.user.id,
    action: 'conversation.resume',
    targetType: 'contact',
    targetId: contactId,
    metadata: { agentId, hasNote: !!note },
  }).catch(() => {})

  return NextResponse.json({ ok: true })
}
