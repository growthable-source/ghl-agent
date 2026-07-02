import Link from 'next/link'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { workspaceRoleHas, type WorkspaceRole } from '@/lib/require-workspace-role'
import { agencyOAuthConfigured } from '@/lib/leadconnector-agency'
import LocationList from '@/components/locations/LocationList'

export const dynamic = 'force-dynamic'

/**
 * Per-location widget control. Internal staff surface — the same list the
 * agency sees in their portal (/portal/locations), so support can flip
 * widgets on a client's behalf. Auth: middleware gates /dashboard/*; the
 * API routes re-check membership + role on every call. Here we only need
 * the role to decide whether the toggles are interactive.
 */
export default async function LocationsPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params

  const session = await auth()
  let canManage = false
  if (session?.user?.id) {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
      select: { role: true },
    })
    canManage = !!member && workspaceRoleHas(member.role as WorkspaceRole, 'admin')
  }

  // .catch: AgencyConnection may not exist yet on un-migrated DBs (Ryan
  // hand-runs SQL after deploy). Treat as "not connected" instead of 500.
  const connection = await db.agencyConnection.findFirst({
    where: { workspaceId },
    select: { id: true, companyId: true },
  }).catch(() => null)

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Locations</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Turn the chat widget on or off per location in your CRM. Locations sync
          from your agency-level connection; the widget embed must include{' '}
          <code className="text-xs text-zinc-400">data-location-id</code> for the
          toggle to apply.
        </p>
      </div>

      {!connection ? (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-8 text-center space-y-4">
          <p className="text-sm text-zinc-300">
            No agency connection yet. Connect your CRM agency account to pull in
            every location and control widgets per location.
          </p>
          {agencyOAuthConfigured() ? (
            canManage ? (
              <Link
                href={`/api/auth/leadconnector-agency/install?workspaceId=${workspaceId}`}
                className="inline-flex rounded-lg bg-accent-primary-bg px-4 py-2 text-sm font-medium text-accent-primary"
              >
                Connect agency account
              </Link>
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
          apiBase={`/api/workspaces/${workspaceId}/agency-locations`}
          canManage={canManage}
        />
      )}
    </div>
  )
}
