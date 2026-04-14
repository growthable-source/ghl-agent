import { NextRequest, NextResponse } from 'next/server'
import { pauseConversation, resumeConversation } from '@/lib/conversation-state'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; contactId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const { agentId, reason } = body
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  const record = await pauseConversation(agentId, contactId, reason ?? 'manual')
  return NextResponse.json({ record })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const { agentId } = body
  if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })
  const record = await resumeConversation(agentId, contactId)
  return NextResponse.json({ record })
}
