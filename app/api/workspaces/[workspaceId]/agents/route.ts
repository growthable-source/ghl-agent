import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agents = await db.agent.findMany({
    where: { workspaceId },
    include: {
      _count: { select: { knowledgeEntries: true, routingRules: true, messageLogs: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ agents })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json()
  const location = await db.location.findFirst({ where: { workspaceId }, select: { id: true } })
  const agent = await db.agent.create({
    data: {
      workspaceId,
      locationId: location?.id ?? workspaceId,
      name: body.name,
      systemPrompt: body.systemPrompt,
      instructions: body.instructions ?? null,
      ...(body.enabledTools !== undefined && { enabledTools: body.enabledTools }),
    },
  })
  return NextResponse.json({ agent }, { status: 201 })
}
