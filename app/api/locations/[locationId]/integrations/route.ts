import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

type Params = { params: Promise<{ locationId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId } = await params

  const integrations = await db.integration.findMany({
    where: { locationId },
    orderBy: { createdAt: 'asc' },
  })

  const location = await db.location.findUnique({ where: { id: locationId } })
  const ghlConnected = !!(location?.accessToken)

  return NextResponse.json({ integrations, ghlConnected })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId } = await params
  const body = await req.json()

  const integration = await db.integration.create({
    data: {
      locationId,
      type: body.type,
      name: body.name,
      credentials: body.credentials,
      config: body.config || {},
      isActive: true,
    },
  })

  return NextResponse.json({ integration }, { status: 201 })
}
