import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Per-workspace GHL connection health dashboard — admin-only. Shows
 * every Location row, its token expiry, computed status, and last-seen
 * install / scope info. The customer-facing version
 * (/api/workspaces/:ws/connection-health) returns a single status
 * string with no metadata so ops detail never leaks.
 */
export default async function AdminConnectionHealthPage({ params }: Params) {
  const session = await getAdminSession()
  if (!session || !session.twoFactorVerified) redirect('/admin/login')

  const { id: workspaceId } = await params

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, name: true },
  })
  if (!workspace) redirect('/admin/workspaces')

  const locations = await db.location.findMany({
    where: { workspaceId },
    select: {
      id: true,
      companyId: true,
      userType: true,
      crmProvider: true,
      scope: true,
      expiresAt: true,
      installedAt: true,
    },
    orderBy: { installedAt: 'desc' },
  })

  const now = Date.now()
  const oneHourMs = 60 * 60 * 1000

  return (
    <div className="p-8 max-w-5xl space-y-6">
      <div>
        <Link href={`/admin/workspaces/${workspaceId}`} className="text-xs text-zinc-500 hover:text-white">
          ← {workspace.name}
        </Link>
        <h1 className="text-xl font-semibold mt-2">Connection health</h1>
        <p className="text-sm text-zinc-500 mt-1">
          GHL OAuth token state per location. The proactive refresh cron
          ({' '}<span className="font-mono">/api/cron/refresh-tokens</span>{' '})
          runs every 30 minutes and keeps tokens alive until either the
          refresh_token ages out naturally or the workspace uninstalls
          the app.
        </p>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Location</th>
              <th className="text-left px-4 py-2 font-semibold">Provider</th>
              <th className="text-left px-4 py-2 font-semibold">Status</th>
              <th className="text-left px-4 py-2 font-semibold">Expires</th>
              <th className="text-left px-4 py-2 font-semibold">Installed</th>
              <th className="text-left px-4 py-2 font-semibold">Scope</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {locations.map(l => {
              const expiry = l.expiresAt.getTime()
              const isExpired = expiry < now
              const isNearExpiry = !isExpired && expiry < now + oneHourMs
              const isPlaceholder = l.crmProvider === 'none'
              return (
                <tr key={l.id} className="hover:bg-zinc-900/50">
                  <td className="px-4 py-2.5 font-mono text-zinc-400">{l.id}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{l.crmProvider}</td>
                  <td className="px-4 py-2.5">
                    {isPlaceholder ? (
                      <span className="text-zinc-500">Placeholder (no CRM)</span>
                    ) : isExpired ? (
                      <span className="text-red-400">Expired — refresh needed</span>
                    ) : isNearExpiry ? (
                      <span className="text-amber-400">Near expiry</span>
                    ) : (
                      <span className="text-emerald-400">Healthy</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">
                    {isPlaceholder ? '—' : l.expiresAt.toISOString().slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">
                    {l.installedAt.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-600 font-mono max-w-[320px] truncate" title={l.scope}>
                    {l.scope || '—'}
                  </td>
                </tr>
              )
            })}
            {locations.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-500">
                  No locations connected to this workspace.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
