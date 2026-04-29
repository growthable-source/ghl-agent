import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Workspace-level knowledge library.
 *
 * GET — every entry in the workspace, with the count of agents currently
 * connected to each (so the list view can render "Used by 3 agents").
 *
 * POST — create a new entry in the workspace pool. Optional
 * `connectToAgentIds` body field auto-attaches the new entry to those
 * agents. Bare creation (no connections) drops the entry into the pool
 * for any agent to pick up later.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let entries: any[] = []
  try {
    entries = await db.knowledgeEntry.findMany({
      where: { workspaceId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: {
        attachments: { select: { agentId: true } },
        agent: { select: { id: true, name: true } },
      } as any,
    })
  } catch (err: any) {
    // Migration pending — workspaceId column doesn't exist yet. Surface
    // an empty list with a flag so the page can show a CTA to run the SQL.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ entries: [], notMigrated: true })
    }
    throw err
  }

  return NextResponse.json({
    entries: entries.map((e: any) => ({
      id: e.id,
      title: e.title,
      content: e.content,
      source: e.source,
      sourceUrl: e.sourceUrl,
      tokenEstimate: e.tokenEstimate,
      status: e.status,
      createdAt: e.createdAt.toISOString(),
      updatedAt: e.updatedAt.toISOString(),
      createdByAgent: e.agent ? { id: e.agent.id, name: e.agent.name } : null,
      connectedAgentCount: Array.isArray(e.attachments) ? e.attachments.length : 0,
      connectedAgentIds: Array.isArray(e.attachments) ? e.attachments.map((a: any) => a.agentId) : [],
    })),
  })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (!content) return NextResponse.json({ error: 'content required' }, { status: 400 })

  const allowedSources = ['manual', 'qa', 'notion', 'youtube', 'url']
  const source = typeof body.source === 'string' && allowedSources.includes(body.source)
    ? body.source
    : 'manual'
  const sourceUrl = typeof body.sourceUrl === 'string' && body.sourceUrl ? body.sourceUrl : null
  const connectToAgentIds: string[] = Array.isArray(body.connectToAgentIds)
    ? body.connectToAgentIds.filter((s: unknown) => typeof s === 'string')
    : []

  // Verify any requested agent attachments belong to this workspace
  // (defense-in-depth; the UI only offers in-workspace agents).
  if (connectToAgentIds.length > 0) {
    const agents = await db.agent.findMany({
      where: { id: { in: connectToAgentIds }, workspaceId },
      select: { id: true },
    })
    const validIds = new Set(agents.map(a => a.id))
    for (const id of connectToAgentIds) {
      if (!validIds.has(id)) {
        return NextResponse.json({ error: `Agent ${id} is not in this workspace` }, { status: 400 })
      }
    }
  }

  let entry: any
  try {
    entry = await db.knowledgeEntry.create({
      data: {
        workspaceId,
        title,
        content,
        source,
        sourceUrl,
        // No creator agent for workspace-level creates. attachments are
        // wired up in a follow-up createMany so we keep the row tiny if
        // the caller didn't pass any.
        attachments: connectToAgentIds.length > 0
          ? { create: connectToAgentIds.map(agentId => ({ agentId })) }
          : undefined,
      } as any,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Knowledge migration pending — run prisma/migrations/20260429140000_workspace_knowledge/migration.sql.',
        code: 'MIGRATION_PENDING',
      }, { status: 503 })
    }
    throw err
  }

  return NextResponse.json({ entry }, { status: 201 })
}
