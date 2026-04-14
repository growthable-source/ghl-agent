import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access

  const integrations = await db.integration.findMany({
    where: { locationId },
    orderBy: { createdAt: 'asc' },
  })

  const location = await db.location.findUnique({
    where: { id: locationId },
    select: { accessToken: true, crmProvider: true },
  })
  const ghlConnected = !!(location?.accessToken)
  const crmProvider = location?.crmProvider ?? 'ghl'

  const vapiActive = !!process.env.VAPI_API_KEY

  return NextResponse.json({ integrations, ghlConnected, vapiActive, crmProvider })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
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

export async function PATCH(req: NextRequest, { params }: Params) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  if (body.crmProvider) {
    const allowed = ['ghl', 'hubspot']
    if (!allowed.includes(body.crmProvider)) {
      return NextResponse.json({ error: `Invalid CRM provider. Must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }
    await db.location.update({
      where: { id: locationId },
      data: { crmProvider: body.crmProvider },
    })
    return NextResponse.json({ crmProvider: body.crmProvider })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
