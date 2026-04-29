import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string; entryId: string }> }

/**
 * Per-agent edit/detach for a workspace knowledge entry.
 *
 * PATCH — edit title/content (the entry is workspace-shared, so the
 * change propagates to every agent connected to it; that's by design —
 * single source of truth, not snapshot-on-share).
 *
 * DELETE — *detach* the entry from this specific agent (remove the
 * AgentKnowledge junction row). The entry itself stays in the workspace
 * pool. To delete the entry entirely, use the workspace knowledge
 * endpoint at /workspaces/[id]/knowledge/[entryId] DELETE.
 */

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Verify the entry belongs to this workspace.
  const existing = await db.knowledgeEntry.findFirst({
    where: { id: entryId, workspaceId } as any,
    select: { id: true },
  }).catch(() => null)
  if (!existing) {
    // Fallback for pre-migration setups where workspaceId column doesn't
    // exist yet — fall back to the old find-by-id-only behavior so the
    // editor stays usable until the migration is run.
    const legacy = await db.knowledgeEntry.findUnique({
      where: { id: entryId },
      select: { id: true },
    })
    if (!legacy) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const body = await req.json()
  const entry = await db.knowledgeEntry.update({
    where: { id: entryId },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
    },
  })
  return NextResponse.json({ entry })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Detach by removing the junction row. The entry survives in the
  // workspace pool — undo is just re-attaching from the agent's
  // knowledge page or the workspace library.
  try {
    await db.agentKnowledge.deleteMany({
      where: { agentId, knowledgeEntryId: entryId },
    })
  } catch (err: any) {
    // Migration-pending fallback: pre-junction installs still expect
    // DELETE to remove the entry. Mirror that legacy behavior so a
    // half-migrated environment doesn't surface a phantom entry.
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      await db.knowledgeEntry.delete({ where: { id: entryId } }).catch(() => {})
      return NextResponse.json({ success: true, legacy: true })
    }
    throw err
  }

  return NextResponse.json({ success: true })
}
