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
    if (!tokens) {
      return NextResponse.json({
        tags: [],
        error: 'Not connected to your CRM.',
        code: 'not_connected',
      })
    }
    // Missing scope on the stored token — no point round-tripping to the
    // CRM just to get a 401. Check explicitly so we can return a precise
    // hint. If the user has reconnected recently and still hits this,
    // check the marketplace listing config — `locations/tags.readonly`
    // has to be enabled in the app's allowed scopes for the OAuth grant
    // to include it. The OAuth callback logs the granted scope set for
    // exactly this kind of diagnosis (`[OAuth] Granted scope for …`).
    if (!tokens.scope?.includes('locations/tags.readonly')) {
      return NextResponse.json({
        tags: [],
        error: 'Your LeadConnector connection is missing the tags scope. Reconnect from Integrations — if the error persists after reconnecting, the marketplace listing needs the tags scope enabled.',
        code: 'reconnect_required',
      })
    }
    const adapter = new GhlAdapter(locationId)
    const tags = await adapter.getTags()
    return NextResponse.json({ tags })
  } catch (err: any) {
    // Translate the common 401 / scope error into a reconnect hint. The
    // adapter throws the raw GHL response body, which for scope failures
    // mentions "authClass" or returns status 401.
    const msg: string = err?.message ?? 'Unknown error'
    const isAuth = msg.includes('401') || /scope|unauthor/i.test(msg)
    console.error('[Tags] fetch failed:', msg)
    return NextResponse.json({
      tags: [],
      error: isAuth
        ? 'Your LeadConnector connection needs to be reconnected (tags scope missing or token expired).'
        : `Couldn't load tags: ${msg}`,
      code: isAuth ? 'reconnect_required' : 'fetch_failed',
    })
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
