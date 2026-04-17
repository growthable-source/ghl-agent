import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { GhlAdapter } from '@/lib/crm/ghl/adapter'
import { getTokens } from '@/lib/token-store'

type Params = { params: Promise<{ workspaceId: string; locationId: string }> }

/**
 * GET — list all GHL tags for this location
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, locationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  // Verify the location belongs to this workspace
  const location = await db.location.findFirst({
    where: { id: locationId, workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  try {
    const tokens = await getTokens(locationId)
    if (!tokens) return NextResponse.json({ tags: [] })
    const adapter = new GhlAdapter(locationId)
    const tags = await adapter.getTags()
    return NextResponse.json({ tags })
  } catch (err: any) {
    console.error('[Tags] fetch failed:', err.message)
    return NextResponse.json({ tags: [], error: err.message })
  }
}

/**
 * POST — create a new tag in GHL
 * Body: { name }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, locationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  if (!body.name || typeof body.name !== 'string') {
    return NextResponse.json({ error: 'Name required' }, { status: 400 })
  }

  const location = await db.location.findFirst({
    where: { id: locationId, workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'Location not found' }, { status: 404 })

  try {
    const tokens = await getTokens(locationId)
    if (!tokens) return NextResponse.json({ error: 'No token for location' }, { status: 500 })
    const adapter = new GhlAdapter(locationId)
    const tag = await adapter.createTag(body.name.trim())
    if (!tag) return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 })
    return NextResponse.json({ tag })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
