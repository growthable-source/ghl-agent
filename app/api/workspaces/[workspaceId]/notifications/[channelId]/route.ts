import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { notify } from '@/lib/notifications'

type Params = { params: Promise<{ workspaceId: string; channelId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, channelId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  if (body.action === 'test') {
    // Send a test notification through this channel
    await notify({
      workspaceId,
      event: 'test',
      title: 'Voxility test notification',
      body: 'If you see this, your notification channel is working!',
      severity: 'info',
    })
    return NextResponse.json({ success: true })
  }

  const channel = await db.notificationChannel.update({
    where: { id: channelId },
    data: {
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.events !== undefined && { events: body.events }),
      ...(body.config !== undefined && { config: body.config }),
    },
  })
  return NextResponse.json({ channel })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, channelId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await db.notificationChannel.delete({ where: { id: channelId } })
  return NextResponse.json({ success: true })
}
