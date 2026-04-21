import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

export default async function AdminOverviewPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  // Broad cross-workspace counts. Most of these are indexed one-column
  // COUNTs — cheap even at scale. We do them in parallel so the total
  // page-load cost is max(individual query), not sum.
  const since7d = new Date(Date.now() - 7 * 86_400_000)
  const since30d = new Date(Date.now() - 30 * 86_400_000)

  const [
    workspaceCount,
    userCount,
    agentCount,
    locationCount,
    messagesLast7d,
    errorsLast7d,
    paidPlanCount,
    trialCount,
    pausedCount,
    needsApprovalCount,
    recentErrors,
    recentSignups,
  ] = await Promise.all([
    db.workspace.count(),
    db.user.count(),
    db.agent.count(),
    db.location.count({ where: { crmProvider: { not: 'none' } } }),
    db.messageLog.count({ where: { createdAt: { gte: since7d } } }),
    db.messageLog.count({ where: { createdAt: { gte: since7d }, status: 'ERROR' } }),
    db.workspace.count({ where: { plan: { not: 'trial' } } }),
    db.workspace.count({ where: { plan: 'trial' } }),
    db.workspace.count({ where: { isPaused: true } }),
    db.messageLog.count({ where: { needsApproval: true, approvalStatus: 'pending' } }),
    db.messageLog.findMany({
      where: { status: 'ERROR', createdAt: { gte: since30d } },
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, locationId: true, agentId: true, errorMessage: true, createdAt: true },
    }),
    db.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { id: true, name: true, email: true, createdAt: true, companyName: true },
    }),
  ])

  logAdminAction({ admin: session, action: 'view_overview' }).catch(() => {})

  return (
    <div className="p-8 max-w-6xl space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Overview</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Cross-workspace snapshot. Figures update live — this page is never cached.
        </p>
      </div>

      {/* Primary KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Workspaces" value={workspaceCount} />
        <Stat label="Users" value={userCount} />
        <Stat label="Agents" value={agentCount} />
        <Stat label="CRM locations" value={locationCount} hint="Non-placeholder installs" />
      </section>

      {/* Plan breakdown */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Paid plans" value={paidPlanCount} tone="good" />
        <Stat label="Trials" value={trialCount} tone="muted" />
        <Stat label="Paused workspaces" value={pausedCount} tone={pausedCount > 0 ? 'warn' : 'muted'} />
        <Stat label="Approvals pending" value={needsApprovalCount} tone={needsApprovalCount > 0 ? 'warn' : 'muted'} />
      </section>

      {/* Activity KPIs */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Messages (7d)" value={messagesLast7d} />
        <Stat label="Errors (7d)" value={errorsLast7d} tone={errorsLast7d > 0 ? 'warn' : 'muted'} />
        <Stat
          label="Error rate (7d)"
          value={messagesLast7d > 0 ? `${((errorsLast7d / messagesLast7d) * 100).toFixed(2)}%` : '—'}
          tone={messagesLast7d > 0 && errorsLast7d / messagesLast7d > 0.02 ? 'warn' : 'muted'}
        />
        <Stat label="Paid %" value={workspaceCount > 0 ? `${Math.round((paidPlanCount / workspaceCount) * 100)}%` : '—'} />
      </section>

      {/* Recent errors */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-200">Recent errors (last 30 days)</h2>
          <Link href="/admin/logs?status=ERROR" className="text-xs text-blue-400 hover:text-blue-300">
            All logs →
          </Link>
        </div>
        {recentErrors.length === 0 ? (
          <p className="text-xs text-zinc-500 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            No errors in the last 30 days.
          </p>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
            {recentErrors.map(e => (
              <div key={e.id} className="px-4 py-2.5 text-xs grid grid-cols-[auto,1fr,auto] gap-4 items-start">
                <span className="text-zinc-600 font-mono">{short(e.createdAt.toISOString())}</span>
                <span className="text-zinc-300 truncate" title={e.errorMessage ?? ''}>
                  {e.errorMessage ?? '(no error message)'}
                </span>
                <span className="text-zinc-600 font-mono">{e.locationId.slice(-8)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recent signups */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-200">Latest signups</h2>
          <Link href="/admin/users" className="text-xs text-blue-400 hover:text-blue-300">
            All users →
          </Link>
        </div>
        {recentSignups.length === 0 ? (
          <p className="text-xs text-zinc-500 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            No users yet.
          </p>
        ) : (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
            {recentSignups.map(u => (
              <div key={u.id} className="px-4 py-2.5 text-xs grid grid-cols-[auto,1fr,auto,auto] gap-4 items-center">
                <span className="text-zinc-600 font-mono">{short(u.createdAt.toISOString())}</span>
                <span className="text-zinc-300 truncate">{u.name ?? '(no name)'}</span>
                <span className="text-zinc-500 truncate">{u.email}</span>
                <span className="text-zinc-600 truncate max-w-[140px]">{u.companyName ?? ''}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({
  label, value, hint, tone = 'default',
}: { label: string; value: number | string; hint?: string; tone?: 'default' | 'good' | 'warn' | 'muted' }) {
  const tint =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/[0.04]' :
    tone === 'warn' ? 'border-amber-500/40 bg-amber-500/[0.05]' :
    tone === 'muted' ? 'border-zinc-800 bg-zinc-950' :
    'border-zinc-800 bg-zinc-950'
  return (
    <div className={`rounded-lg border p-4 ${tint}`}>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold text-zinc-100 mt-1">{value}</p>
      {hint && <p className="text-[11px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  )
}

function short(iso: string): string {
  // 2026-04-21T14:02 → enough for context without blowing out the row
  return iso.slice(0, 16).replace('T', ' ')
}
