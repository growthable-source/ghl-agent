import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { fireWebhook } from '@/lib/webhooks'

type Params = { params: Promise<{ workspaceId: string; subscriptionId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, subscriptionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  if (body.action === 'test') {
    await fireWebhook({
      workspaceId,
      event: 'test',
      payload: { message: 'Voxility webhook test', triggeredBy: access.session.user.id, timestamp: new Date().toISOString() },
    })
    return NextResponse.json({ success: true })
  }

  const sub = await db.webhookSubscription.update({
    where: { id: subscriptionId },
    data: {
      ...(body.url !== undefined && { url: body.url }),
      ...(body.events !== undefined && { events: body.events }),
      ...(body.isActive !== undefined && { isActive: body.isActive }),
    },
  })
  return NextResponse.json({ subscription: sub })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, subscriptionId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await db.webhookSubscription.delete({ where: { id: subscriptionId } })
  return NextResponse.json({ success: true })
}
