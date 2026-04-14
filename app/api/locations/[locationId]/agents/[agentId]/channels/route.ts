import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string; agentId: string }> }

// GET — list all channel deployments for this agent
export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access

  const deployments = await db.channelDeployment.findMany({
    where: { agentId },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ deployments })
}

// PUT — bulk upsert channel deployments (toggle channels on/off)
export async function PUT(req: NextRequest, { params }: Params) {
  const { locationId, agentId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const { channels } = body as { channels: { channel: string; isActive: boolean; config?: any }[] }

  if (!Array.isArray(channels)) {
    return NextResponse.json({ error: 'channels array is required' }, { status: 400 })
  }

  const results = await Promise.all(
    channels.map(ch =>
      db.channelDeployment.upsert({
        where: { agentId_channel: { agentId, channel: ch.channel } },
        create: {
          agentId,
          channel: ch.channel,
          isActive: ch.isActive,
          config: ch.config ?? null,
        },
        update: {
          isActive: ch.isActive,
          ...(ch.config !== undefined ? { config: ch.config } : {}),
        },
      })
    )
  )

  return NextResponse.json({ deployments: results })
}
