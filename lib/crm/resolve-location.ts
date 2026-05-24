import { db } from '@/lib/db'

export type RequestedProvider = 'native' | 'ghl' | 'hubspot' | 'none' | undefined

/**
 * Resolve a `crmProvider` choice from the API caller down to a concrete
 * Location row that an Agent can FK to.
 *
 * Two modes:
 *
 *   strict=false (default, used by agent CREATE)
 *     If no matching Location exists for the requested provider, fall
 *     back to the workspace's most-recent install. If even that returns
 *     nothing, lazily create a `placeholder:<wsId>` Location with
 *     crmProvider='none' so the FK is satisfied. Placeholders are how a
 *     brand-new workspace with no CRM connected gets its first agent off
 *     the ground.
 *
 *   strict=true (used by agent PATCH)
 *     Return null when the requested provider has no Location. The caller
 *     should surface a 400 so the user goes back to workspace Integrations
 *     and connects the CRM first. Lazily creating a placeholder on a
 *     PATCH would silently change behaviour ("I picked HubSpot but my
 *     agent is now on a no-op adapter") — that's the wrong default.
 */
export async function resolveLocationForProvider(opts: {
  workspaceId: string
  requestedProvider: RequestedProvider
  strict?: boolean
}): Promise<{ id: string } | null> {
  const { workspaceId, requestedProvider, strict = false } = opts

  let location: { id: string } | null = null

  if (requestedProvider === 'native') {
    location = await db.location.findFirst({
      where: { id: `native:${workspaceId}` },
      select: { id: true },
    })
  } else if (requestedProvider === 'ghl') {
    location = await db.location.findFirst({
      where: {
        workspaceId,
        crmProvider: 'ghl',
        NOT: { id: { startsWith: 'native:' } },
      },
      select: { id: true },
      orderBy: { installedAt: 'desc' },
    })
  } else if (requestedProvider === 'hubspot') {
    location = await db.location.findFirst({
      where: { workspaceId, crmProvider: 'hubspot' },
      select: { id: true },
      orderBy: { installedAt: 'desc' },
    })
  }

  if (location) return location

  if (strict) return null

  // Non-strict fallback: any Location belonging to this workspace, prefer
  // the most-recent real install over old placeholders.
  location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
    orderBy: { installedAt: 'desc' },
  })
  if (location) return location

  // Still nothing — create a placeholder so the FK is satisfied. The
  // factory routes crmProvider='none' to a no-op adapter that throws
  // "CRM not connected" on every call, which is the correct behaviour
  // for an agent created before any CRM is wired up.
  const placeholderId = `placeholder:${workspaceId}`
  return db.location.upsert({
    where: { id: placeholderId },
    create: {
      id: placeholderId,
      workspaceId,
      companyId: '',
      userId: '',
      userType: '',
      scope: '',
      accessToken: '',
      refreshToken: '',
      refreshTokenId: '',
      expiresAt: new Date(0),
      crmProvider: 'none',
    },
    update: {},
    select: { id: true },
  })
}
