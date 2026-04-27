import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const entries = await db.knowledgeEntry.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ entries })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  // Allow callers to tag the entry's source ("manual" | "qa" | "notion" |
  // "youtube" | "url"). Defaults to "manual" so the existing Write tab
  // keeps working unchanged.
  const allowedSources = ['manual', 'qa', 'notion', 'youtube', 'url']
  const source = typeof body.source === 'string' && allowedSources.includes(body.source)
    ? body.source
    : 'manual'
  const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : null

  const entry = await db.knowledgeEntry.create({
    data: {
      agentId,
      title: body.title,
      content: body.content,
      source,
      sourceUrl,
    },
  })
  return NextResponse.json({ entry }, { status: 201 })
}
