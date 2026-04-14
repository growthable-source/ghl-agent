import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Get all locationIds for this workspace
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true, accessToken: true, crmProvider: true },
  })
  const locationIds = locations.map(l => l.id)

  const integrations = await db.integration.findMany({
    where: { locationId: { in: locationIds } },
    orderBy: { createdAt: 'asc' },
  })

  const ghlConnected = locations.some(l => !!l.accessToken)
  const crmProvider = locations[0]?.crmProvider ?? 'ghl'

  const vapiActive = !!process.env.VAPI_API_KEY

  return NextResponse.json({ integrations, ghlConnected, vapiActive, crmProvider })
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  // Use the first location for this workspace
  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })

  const integration = await db.integration.create({
    data: {
      locationId: location.id,
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
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()

  if (body.crmProvider) {
    const allowed = ['ghl', 'hubspot']
    if (!allowed.includes(body.crmProvider)) {
      return NextResponse.json({ error: `Invalid CRM provider. Must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }
    // Update all locations in this workspace
    await db.location.updateMany({
      where: { workspaceId },
      data: { crmProvider: body.crmProvider },
    })
    return NextResponse.json({ crmProvider: body.crmProvider })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}
