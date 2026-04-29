import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; entryId: string }> }

/**
 * GET — full entry incl. its current connected agent IDs (for the
 * editor's "Stack on agents" multi-select).
 *
 * PATCH — edit title/content/sourceUrl. (Source type is fixed at create
 * — switching e.g. from "manual" to "notion" would change semantics
 * around re-sync.)
 *
 * DELETE — remove the entry from the workspace. Cascades through
 * AgentKnowledge so every connected agent loses it on next prompt build.
 */

async function loadEntryGuarded(workspaceId: string, entryId: string) {
  return db.knowledgeEntry.findFirst({
    where: { id: entryId, workspaceId },
    include: {
      attachments: { select: { agentId: true } },
      agent: { select: { id: true, name: true } },
    } as any,
  })
}

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const entry: any = await loadEntryGuarded(workspaceId, entryId)
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({
    entry: {
      id: entry.id,
      title: entry.title,
      content: entry.content,
      source: entry.source,
      sourceUrl: entry.sourceUrl,
      tokenEstimate: entry.tokenEstimate,
      status: entry.status,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
      createdByAgent: entry.agent ? { id: entry.agent.id, name: entry.agent.name } : null,
      connectedAgentIds: entry.attachments?.map((a: any) => a.agentId) ?? [],
    },
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim()
  if (typeof body.content === 'string' && body.content.trim()) data.content = body.content.trim()
  if (body.sourceUrl !== undefined) {
    data.sourceUrl = typeof body.sourceUrl === 'string' && body.sourceUrl.trim() ? body.sourceUrl.trim() : null
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const existing = await loadEntryGuarded(workspaceId, entryId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const entry = await db.knowledgeEntry.update({ where: { id: entryId }, data })
  return NextResponse.json({ entry })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, entryId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const existing = await loadEntryGuarded(workspaceId, entryId)
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.knowledgeEntry.delete({ where: { id: entryId } })
  return NextResponse.json({ success: true })
}
