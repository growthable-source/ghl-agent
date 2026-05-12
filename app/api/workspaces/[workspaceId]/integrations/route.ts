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

  // ghlConnected means specifically "real LeadConnector OAuth install".
  // Excludes the `native:<wsId>` row (which carries sentinel accessToken
  // values, not a real OAuth token) and `placeholder:` rows. Without
  // this guard, every workspace with auto-provisioned native shows
  // LeadConnector as connected — surfacing a "Reconnect" button on a
  // CRM the user never linked.
  const ghlConnected = locations.some(l =>
    !!l.accessToken &&
    l.crmProvider === 'ghl' &&
    !l.id.startsWith('native:') &&
    !l.id.startsWith('placeholder:')
  )
  // Pick the canonical CRM provider for this workspace. Prefer a real
  // GHL/HubSpot install if present, otherwise fall back to the first
  // location's provider (typically the native: row).
  const realLocation = locations.find(l => !l.id.startsWith('native:') && !l.id.startsWith('placeholder:'))
  const crmProvider = realLocation?.crmProvider ?? locations[0]?.crmProvider ?? 'ghl'

  const vapiActive = !!process.env.VAPI_API_KEY

  // Shopify lives on a workspace-scoped table, not Location.
  // Returns null when no row exists OR when uninstalledAt is set so the
  // UI can treat "uninstalled" the same as "never connected" — both
  // states show a Connect button, not Reconnect.
  const shopifyRow = await db.shopifyShop.findUnique({
    where: { workspaceId },
    select: { id: true, scope: true, installedAt: true, uninstalledAt: true },
  })
  const shopify = shopifyRow && !shopifyRow.uninstalledAt
    ? { shop: shopifyRow.id, scope: shopifyRow.scope, installedAt: shopifyRow.installedAt }
    : null

  return NextResponse.json({ integrations, ghlConnected, vapiActive, crmProvider, shopify })
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
    const allowed = ['ghl', 'hubspot', 'native']
    if (!allowed.includes(body.crmProvider)) {
      return NextResponse.json({ error: `Invalid CRM provider. Must be one of: ${allowed.join(', ')}` }, { status: 400 })
    }
    // Only flip non-native Location rows — the `native:<wsId>` row's
    // crmProvider must stay 'native' regardless of what the workspace's
    // active CRM is, because the factory's prefix-based routing keys off
    // the row's identity. The active CRM is determined by which Location
    // an agent's locationId points to (which is set at agent creation).
    await db.location.updateMany({
      where: {
        workspaceId,
        NOT: { id: { startsWith: 'native:' } },
      },
      data: { crmProvider: body.crmProvider },
    })
    return NextResponse.json({ crmProvider: body.crmProvider })
  }

  return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
}

/**
 * Disconnect the GHL/HubSpot CRM connection for this workspace.
 *
 * Blanks OAuth tokens on the workspace's real Location rows (not
 * `native:` or `placeholder:` rows) and flips crmProvider to 'native'
 * so the integrations page reflects the disconnect (the ghlConnected
 * check on GET requires crmProvider === 'ghl' AND a non-empty
 * accessToken). MessageLogs, Agents, RoutingRules, and ChannelDeployments
 * are left intact — reconnecting later resumes cleanly because the
 * OAuth callback re-fills tokens on the same Location row (keyed by GHL
 * locationId) and resets crmProvider back to 'ghl'.
 *
 * Inbound webhooks for a disconnected location no-op safely: the
 * webhook handler at app/api/webhooks/events/route.ts:137-141 calls
 * getTokens(locationId), gets back null because the tokens are blank,
 * logs "No tokens for location ..." and breaks before any agent runs.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const realLocations = await db.location.findMany({
    where: {
      workspaceId,
      NOT: [
        { id: { startsWith: 'native:' } },
        { id: { startsWith: 'placeholder:' } },
      ],
    },
    select: { id: true },
  })

  if (realLocations.length === 0) {
    return NextResponse.json(
      { error: 'No CRM connection to disconnect on this workspace' },
      { status: 404 },
    )
  }

  await db.location.updateMany({
    where: { id: { in: realLocations.map(l => l.id) } },
    data: {
      accessToken: '',
      refreshToken: '',
      refreshTokenId: '',
      crmProvider: 'native',
    },
  })

  return NextResponse.json({
    ok: true,
    disconnected: realLocations.length,
    locationIds: realLocations.map(l => l.id),
  })
}
