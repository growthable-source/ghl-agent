import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { agencyOAuthConfigured } from '@/lib/leadconnector-agency'
import LocationList from '@/components/locations/LocationList'
import DisconnectAgencyButton from '@/components/locations/DisconnectAgencyButton'

export const dynamic = 'force-dynamic'

// Human-readable text for the ?error= codes the OAuth flow bounces back
// with. Portal-flavored (brand-neutral, no dashboard references).
const CONNECT_ERRORS: Record<string, string> = {
  not_configured: 'Agency connections aren’t configured on this environment yet.',
  missing_state: 'The sign-in round-trip lost its context — start the connection from this page.',
  missing_code: 'Your CRM didn’t return an authorization code. Try connecting again.',
  widget_not_found: 'This widget could not be matched to the connection attempt.',
  no_company_in_grant: 'The approval came back for a single location, not an agency. Pick the agency account in the chooser.',
  token_exchange_failed: 'Signing in with your CRM failed. Try again, or contact support if it keeps happening.',
  db_not_migrated: 'Connected — but a database update is still pending on our side. Contact support.',
  connection_save_failed: 'Signed in, but saving the connection failed. Try again.',
}

/**
 * Agency-facing per-location widget control — INCLUDING the connect
 * flow: portal users are the agency, so they hold the CRM login and
 * connect their own agency here (portal-install route). Workspace
 * admins have the same powers from the widget's dashboard page.
 */
export default async function PortalLocationsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>
}) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')
  const sp = await searchParams
  const connectError = sp.error ? (CONNECT_ERRORS[sp.error] ?? sp.error) : null
  const justConnected = sp.connected === '1'

  // The portal's widgets + whether each has an active agency connection.
  const widgets = session.brandIds.length
    ? await db.chatWidget.findMany({
        where: { brandId: { in: session.brandIds } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      })
    : []
  // companyName rides a later manual ALTER — fall back to a select
  // without it so the page renders on un-migrated DBs.
  const connections = widgets.length
    ? await db.agencyConnection.findMany({
        where: { widgetId: { in: widgets.map(w => w.id) }, NOT: { accessToken: '' } },
        select: { widgetId: true, companyId: true, companyName: true, createdAt: true },
      }).catch(() =>
        db.agencyConnection.findMany({
          where: { widgetId: { in: widgets.map(w => w.id) }, NOT: { accessToken: '' } },
          select: { widgetId: true, companyId: true, createdAt: true },
        }).then(rows => rows.map(r => ({ ...r, companyName: null as string | null }))).catch(() => []),
      )
    : []
  const connectedWidgetIds = new Set(connections.map(c => c.widgetId))
  const hasConnection = connectedWidgetIds.size > 0
  const unconnected = widgets.filter(w => !connectedWidgetIds.has(w.id))

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn the chat widget on or off for each of your locations.
        </p>
      </div>

      {connectError && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {connectError}
        </div>
      )}
      {justConnected && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
        >
          ✓ Agency connected — your locations are synced below.
        </div>
      )}

      {!hasConnection ? (
        <div className="rounded-xl border border-zinc-800 p-8 text-center space-y-4" style={{ background: 'var(--surface)' }}>
          <p className="text-sm text-zinc-300 max-w-md mx-auto">
            Connect your agency account to pull in every location and control the
            chat widget per location — takes about a minute.
          </p>
          {widgets.length === 0 ? (
            <p className="text-xs text-zinc-500">No chat widgets are set up for your brands yet.</p>
          ) : !agencyOAuthConfigured() ? (
            <p className="text-xs text-zinc-500">Agency connections aren&apos;t configured on this environment yet.</p>
          ) : (
            <div className="space-y-3">
              {/* One connect block per widget — most portals have exactly
                  one. Plain <a>: the install endpoint 302s to the OAuth
                  chooser and next/link 404s on API routes. */}
              {(unconnected.length ? unconnected : widgets).map(w => (
                <div key={w.id} className="space-y-1.5">
                  <a
                    href={`/api/auth/leadconnector-agency/portal-install?widgetId=${w.id}`}
                    className="inline-flex rounded-lg px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: 'var(--portal-accent)' }}
                  >
                    Connect agency account{widgets.length > 1 ? ` · ${w.name}` : ''}
                  </a>
                  <p className="text-xs text-zinc-500">
                    Signed in on gohighlevel.com instead of a whitelabel domain?{' '}
                    <a
                      href={`/api/auth/leadconnector-agency/portal-install?widgetId=${w.id}&variant=standard`}
                      className="underline hover:text-zinc-300"
                    >
                      Connect via gohighlevel.com
                    </a>
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          {/* Connection card(s): WHICH agency each widget is linked to,
              plus the exits — Change agency re-runs the OAuth (upserts in
              place), Disconnect blanks tokens but keeps every toggle. */}
          {connections.map(c => {
            const widget = widgets.find(w => w.id === c.widgetId)
            const label = c.companyName ?? c.companyId
            return (
              <div
                key={c.widgetId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-800 px-4 py-3"
                style={{ background: 'var(--surface)' }}
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-100 truncate">
                    Connected to {c.companyName ?? 'your agency'}
                  </p>
                  <p className="text-xs mt-0.5 font-mono text-zinc-600">
                    {c.companyId}{widget ? ` · via ${widget.name}` : ''} · since {c.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Plain <a>: API-route redirect — next/link 404s on it. */}
                  <a
                    href={`/api/auth/leadconnector-agency/portal-install?widgetId=${c.widgetId}`}
                    className="text-xs px-3 py-1.5 rounded-lg border border-zinc-800 text-zinc-400 transition-opacity hover:opacity-80"
                  >
                    Change agency
                  </a>
                  <DisconnectAgencyButton
                    endpoint={`/api/portal/locations/connection?widgetId=${c.widgetId}`}
                    agencyLabel={label}
                  />
                </div>
              </div>
            )
          })}
          <LocationList apiBase="/api/portal/locations" canManage />
          {unconnected.length > 0 && agencyOAuthConfigured() && (
            <p className="text-xs text-zinc-500">
              {unconnected.length === 1 ? (
                <>The widget &quot;{unconnected[0].name}&quot; isn&apos;t connected to an agency yet —{' '}
                  <a href={`/api/auth/leadconnector-agency/portal-install?widgetId=${unconnected[0].id}`} className="underline hover:text-zinc-300">connect it</a>.</>
              ) : (
                <>Some widgets aren&apos;t connected yet: {unconnected.map((w, i) => (
                  <span key={w.id}>{i > 0 ? ' · ' : ''}<a href={`/api/auth/leadconnector-agency/portal-install?widgetId=${w.id}`} className="underline hover:text-zinc-300">{w.name}</a></span>
                ))}</>
              )}
            </p>
          )}
        </>
      )}
    </div>
  )
}
