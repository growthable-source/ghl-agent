import Link from 'next/link'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { workspaceRoleHas, type WorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured } from '@/lib/leadconnector-agency'
import LocationList from '@/components/locations/LocationList'

export const dynamic = 'force-dynamic'

/**
 * Per-location control for ONE widget (one widget ↔ one agency
 * connection). Internal staff surface — the agency sees the same list in
 * their portal (/portal/locations), so support can flip widgets on a
 * client's behalf. Auth: middleware gates /dashboard/*; the API routes
 * re-check membership + role on every call. Here we only need the role
 * to decide whether the toggles are interactive.
 */
// Human-readable text for the ?error= codes the OAuth install/callback
// routes redirect back with. Anything unrecognised renders verbatim.
const CONNECT_ERRORS: Record<string, string> = {
  not_configured: 'The agency connection isn’t configured on this environment yet (missing OAuth credentials).',
  missing_state: 'The sign-in round-trip lost its context. Start the connection from this page rather than an install link.',
  missing_code: 'Your CRM didn’t return an authorization code. Try connecting again.',
  widget_not_found: 'This widget could not be matched to the connection attempt.',
  no_company_in_grant: 'The approval came back for a single location, not an agency. Pick the agency account in the chooser (the app must be installed at agency level).',
  token_exchange_failed: 'Exchanging the authorization code failed. Check that the app’s client ID/secret and redirect URL match this environment, then try again.',
  db_not_migrated: 'Connected — but the database tables for locations haven’t been created yet. Run prisma/migrations/manual_agency_location_widget_control.sql, then reconnect.',
  connection_save_failed: 'Signed in, but saving the connection failed. Check the server logs and try again.',
}

export default async function WidgetLocationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string; widgetId: string }>
  searchParams: Promise<{ error?: string; connected?: string }>
}) {
  const { workspaceId, widgetId } = await params
  const sp = await searchParams
  const connectError = sp.error ? (CONNECT_ERRORS[sp.error] ?? sp.error) : null
  const justConnected = sp.connected === '1'

  const session = await auth()
  let canManage = false
  if (session?.user?.id) {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
      select: { role: true },
    })
    canManage = !!member && workspaceRoleHas(member.role as WorkspaceRole, 'admin')
  }

  const widget = await db.chatWidget.findFirst({
    where: { id: widgetId, workspaceId },
    select: { id: true, name: true },
  })

  // .catch: AgencyConnection may not exist yet on un-migrated DBs (Ryan
  // hand-runs SQL after deploy). Treat as "not connected" instead of 500.
  const connection = widget
    ? await db.agencyConnection.findFirst({
        where: { widgetId: widget.id, workspaceId },
        select: { id: true, companyId: true },
      }).catch(() => null)
    : null

  if (!widget) {
    return <div className="p-8 text-zinc-500">Widget not found</div>
  }

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <Link
          href={`/dashboard/${workspaceId}/widgets/${widgetId}`}
          className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 inline-block"
        >
          ← Back to {widget.name}
        </Link>
        <h1 className="text-xl font-semibold text-zinc-100">Locations · {widget.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn this widget on or off per location. This widget connects to one
          agency; its embed must include{' '}
          <code className="text-xs text-zinc-400">data-location-id</code> (use the
          &quot;CRM agency install&quot; snippet) for the toggle to apply.
        </p>
      </div>

      {connectError && (
        <div className="rounded-lg border border-zinc-800 bg-accent-red-bg px-4 py-3 text-sm text-accent-red">
          {connectError}
        </div>
      )}
      {justConnected && connection && (
        <div className="rounded-lg border border-zinc-800 bg-accent-primary-bg px-4 py-3 text-sm text-accent-primary">
          Agency connected — locations are syncing below.
        </div>
      )}

      {!connection ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
          <p className="text-sm text-zinc-300">
            This widget isn&apos;t connected to an agency yet. Connect it to pull
            in every location and control the widget per location.
          </p>
          {agencyOAuthConfigured() ? (
            canManage ? (
              // Plain <a>, NOT next/link: the install endpoint is an API
              // route answering with a 302 — client-side router navigation
              // can't resolve it and 404s. Two variants, same app: the
              // whitelabel chooser (leadconnectorhq.com) for agencies on
              // whitelabel domains, and the standard gohighlevel.com login.
              <div className="space-y-2">
                <a
                  href={`/api/auth/leadconnector-agency/install?widgetId=${widget.id}`}
                  className="inline-flex rounded-lg bg-accent-primary-bg px-4 py-2 text-sm font-medium text-accent-primary"
                >
                  Connect agency account
                </a>
                <p className="text-xs text-zinc-500">
                  Signed in on gohighlevel.com instead of a whitelabel domain?{' '}
                  <a
                    href={`/api/auth/leadconnector-agency/install?widgetId=${widget.id}&variant=standard`}
                    className="underline hover:text-zinc-300"
                  >
                    Connect via gohighlevel.com
                  </a>
                </p>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                Ask a workspace admin to connect the agency account.
              </p>
            )
          ) : (
            <p className="text-xs text-zinc-500">
              Agency connection isn&apos;t configured on this environment yet.
            </p>
          )}
        </div>
      ) : (
        <LocationList
          apiBase={`/api/workspaces/${workspaceId}/widgets/${widgetId}/locations`}
          canManage={canManage}
        />
      )}
    </div>
  )
}
