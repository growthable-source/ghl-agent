import { headers } from 'next/headers'
import { db } from '@/lib/db'

/**
 * Slim chrome shown at the top of the dashboard when Voxility is
 * loaded inside a Custom Menu Link iframe. Tells the user which
 * sub-account they're operating in so it's obvious "I'm working on
 * Growthable NSW" vs the picker of seven workspaces they'd see in a
 * regular browser tab.
 *
 * Server-rendered, no hydration cost. Detection is via the
 * `Sec-Fetch-Dest: iframe` request header, which modern browsers
 * (Chrome, Firefox, Safari) all send on iframe document loads.
 * Returns null in the non-iframe path so it has zero impact on the
 * regular dashboard layout.
 *
 * Source of the sub-account name: the most-recent MarketplaceInstall
 * row for this workspace. installSource tells us which marketplace
 * (LeadConnector / Shopify / HubSpot) the install came from so the
 * copy can be tailored, but locationName is the same field in every
 * case — it was set at install time by lib/leadconnector-install-fetcher.
 */
export default async function EmbeddedWorkspaceBanner({ workspaceId }: { workspaceId: string }) {
  const hdrs = await headers()
  const inIframe = hdrs.get('sec-fetch-dest') === 'iframe'
  if (!inIframe) return null

  // Look up the most-recent install snapshot. Tolerant of the
  // MarketplaceInstall table not yet existing (un-migrated DB) — in
  // that case we just don't render. Better silent than crashed.
  let install: { locationName: string | null; companyName: string | null; source: string } | null = null
  try {
    install = await db.marketplaceInstall.findFirst({
      where: { workspaceId },
      orderBy: { installedAt: 'desc' },
      select: { locationName: true, companyName: true, source: true },
    })
  } catch {
    return null
  }

  // No marketplace install on this workspace (someone signed up
  // directly and is somehow looking at the dashboard via an iframe).
  // Don't pretend they came from a marketplace.
  if (!install) return null

  // Prefer the sub-account name. If that's missing (rare — the OAuth
  // scope might not have been granted at install time), fall back to
  // the agency company name. Last resort: a generic label so the
  // banner doesn't render with an empty space.
  const displayName = install.locationName ?? install.companyName ?? 'your sub-account'

  return (
    <div
      className="border-b px-4 py-2 text-xs flex items-center gap-2"
      style={{
        background: 'var(--surface-secondary, #0f1524)',
        borderColor: 'var(--border, #121a2b)',
        color: 'var(--text-secondary, #94a3b8)',
      }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: 'var(--accent-emerald, #10b981)' }}
        aria-hidden
      />
      <span>
        You&apos;re working in the Voxility workspace for{' '}
        <span className="font-semibold" style={{ color: 'var(--text-primary, #f8fafc)' }}>
          {displayName}
        </span>
        {install.source === 'ghl_marketplace' ? ' · connected via LeadConnector' : ''}
      </span>
    </div>
  )
}
