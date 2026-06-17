import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getSlackConnection, setDefaultChannel, deleteSlackConnection } from '@/lib/slack/connection'

type Ctx = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const conn = await getSlackConnection(workspaceId)
  return NextResponse.json({
    connected: !!conn,
    teamName: conn?.teamName ?? null,
    defaultChannelId: conn?.defaultChannelId ?? null,
    defaultChannelName: conn?.defaultChannelName ?? null,
  })
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const body = await req.json().catch(() => null)
  const channelId = body?.defaultChannelId
  const channelName = body?.defaultChannelName
  if (!channelId || !channelName) {
    return NextResponse.json({ error: 'defaultChannelId and defaultChannelName required' }, { status: 400 })
  }
  await setDefaultChannel(workspaceId, channelId, channelName)
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await deleteSlackConnection(workspaceId)
  return NextResponse.json({ ok: true })
}
