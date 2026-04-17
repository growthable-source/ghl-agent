import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { generateWebhookSecret } from '@/lib/webhooks'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const subs = await db.webhookSubscription.findMany({
      where: { workspaceId },
      include: {
        deliveries: {
          orderBy: { deliveredAt: 'desc' },
          take: 5,
          select: { id: true, event: true, statusCode: true, succeeded: true, deliveredAt: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ subscriptions: subs })
  } catch {
    return NextResponse.json({ subscriptions: [], notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  if (!body.url || !body.events) {
    return NextResponse.json({ error: 'url and events required' }, { status: 400 })
  }

  try {
    const sub = await db.webhookSubscription.create({
      data: {
        workspaceId,
        url: body.url,
        events: body.events,
        secret: generateWebhookSecret(),
      },
    })
    return NextResponse.json({ subscription: sub })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
