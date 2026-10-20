/**
 * Request host → the customer brand it is served under.
 *
 * A non-primary host is one of two things (hostnames are unique across
 * both, see ./workspace-domain.ts): an ACTIVE workspace white-label
 * domain, or a portal's customDomain. Everything branded on a custom host
 * — tab title, favicon, manifest, the bare-domain landing — resolves
 * through here so the two kinds can't drift.
 *
 * Fallbacks never land on our own brand: name → Workspace.name, icon →
 * whitelabelFaviconUrl → logoUrl → generated initial (brandIconSvg).
 */

import { cache } from 'react'
import { db } from '@/lib/db'
import { isPrimaryHost } from './primary-hosts'
import { resolveWorkspaceIdForHost } from './workspace-domain'
import type { Metadata } from 'next'
import { brandMetadata, cleanBrandName, type ResolvedBrand } from './brand-metadata'

export type HostBrand = ResolvedBrand & (
  | { kind: 'workspace'; workspaceId: string; rootUrl: string | null }
  | { kind: 'portal'; portalId: string }
)

function bareHost(host: string | null | undefined): string | null {
  const h = (host || '').trim().toLowerCase().split(':')[0]
  return h || null
}

/** https origin for a custom host (used as metadataBase), else null. */
export function customHostOrigin(host: string | null | undefined): string | null {
  const h = bareHost(host)
  return h && !isPrimaryHost(h) ? `https://${h}` : null
}

/**
 * Brand of a white-label-unlocked workspace, or null when it isn't
 * unlocked (unlocked is the commercial gate; an unlocked workspace's
 * pages are branded even when reached via our primary host).
 */
export const getWorkspaceBrand = cache(async (workspaceId: string): Promise<HostBrand | null> => {
  const ws = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      name: true, logoUrl: true, whitelabelUnlocked: true,
      whitelabelBrandName: true, whitelabelFaviconUrl: true, whitelabelRootUrl: true,
    },
  })
  if (!ws?.whitelabelUnlocked) return null
  return {
    kind: 'workspace',
    workspaceId,
    name: cleanBrandName(ws.whitelabelBrandName) || cleanBrandName(ws.name),
    iconUrl: ws.whitelabelFaviconUrl || ws.logoUrl || null,
    accent: null,
    rootUrl: ws.whitelabelRootUrl || null,
  }
})

/** Brand serving this request host, or null (primary/unknown host). */
export const resolveHostBrand = cache(async (host: string | null | undefined): Promise<HostBrand | null> => {
  const h = bareHost(host)
  if (!h || isPrimaryHost(h)) return null
  try {
    const workspaceId = await resolveWorkspaceIdForHost(h)
    if (workspaceId) return await getWorkspaceBrand(workspaceId)
    const portal = await db.portal.findUnique({
      where: { customDomain: h },
      select: { id: true, name: true, logoUrl: true, primaryColor: true, isActive: true },
    })
    if (portal?.isActive) {
      return { kind: 'portal', portalId: portal.id, name: cleanBrandName(portal.name), iconUrl: portal.logoUrl, accent: portal.primaryColor }
    }
  } catch (err) {
    // Branding must never take a page down; the page renders unbranded.
    console.error('[host-brand] lookup failed', err)
  }
  return null
})

/**
 * Metadata for a visitor-facing page owned by `workspaceId` (widget,
 * hosted call, Co-Pilot link): the host's brand on a custom domain, else
 * the workspace's own brand when it is white-label unlocked (the link may
 * have been shared on our host), else null → caller's unbranded default.
 */
export async function visitorPageBrand(
  host: string | null | undefined,
  workspaceId: string | null | undefined,
): Promise<HostBrand | null> {
  return (await resolveHostBrand(host)) ?? (workspaceId ? await getWorkspaceBrand(workspaceId).catch(() => null) : null)
}

export async function visitorPageBrandMetadata(
  host: string | null | undefined,
  workspaceId: string | null | undefined,
): Promise<Metadata | null> {
  const brand = await visitorPageBrand(host, workspaceId)
  return brand ? brandMetadata(brand, customHostOrigin(host)) : null
}
