import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction, roleHas } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export default async function WorkspaceDrillDown({ params }: Params) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const { id } = await params
  const workspace = await db.workspace.findUnique({
    where: { id },
    include: {
      members: {
        include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
        orderBy: { createdAt: 'asc' },
      },
      agents: {
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, isActive: true, isPaused: true,
          agentType: true, createdAt: true, locationId: true,
        },
      },
    },
  })
  if (!workspace) notFound()

  // Pull a few supplementary datasets for context. Location count +
  // recent logs + message volume this week. Each bounded so a huge
  // workspace doesn't make the page hang.
  const since7d = new Date(Date.now() - 7 * 86_400_000)
  const [locationCount, agentIds, messages7d, errors7d, recentLogs] = await Promise.all([
    db.location.count({ where: { workspaceId: id } }),
    workspace.agents.map(a => a.id),
    db.messageLog.count({ where: { agentId: { in: workspace.agents.map(a => a.id) }, createdAt: { gte: since7d } } }),
    db.messageLog.count({ where: { agentId: { in: workspace.agents.map(a => a.id) }, createdAt: { gte: since7d }, status: 'ERROR' } }),
    db.messageLog.findMany({
      where: { agentId: { in: workspace.agents.map(a => a.id) } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true, agentId: true, contactId: true, status: true,
        inboundMessage: true, errorMessage: true, createdAt: true,
      },
    }),
  ])

  logAdminAction({
    admin: session,
    action: 'view_workspace_detail',
    target: id,
  }).catch(() => {})

  const canMutate = roleHas(session.role, 'admin')

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Link href="/admin/workspaces" className="text-xs text-zinc-500 hover:text-white">
            ← All workspaces
          </Link>
          <h1 className="text-xl font-semibold mt-2">{workspace.name}</h1>
          <p className="text-xs text-zinc-500 mt-1 font-mono">
            {workspace.slug} · {workspace.id}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/admin/workspaces/${workspace.id}/routing-diagnostic`}
            className="text-xs font-medium border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors"
          >
            Routing diagnostic →
          </Link>
          <Link
            href={`/admin/workspaces/${workspace.id}/connection-health`}
            className="text-xs font-medium border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors"
          >
            Connection health →
          </Link>
          {canMutate && (
            <form action={`/api/admin/workspaces/${workspace.id}/pause`} method="post">
              <button
                type="submit"
                className={`text-xs font-medium border rounded-lg px-3 py-2 transition-colors ${
                  workspace.isPaused
                    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20'
                    : 'text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
                }`}
              >
                {workspace.isPaused ? 'Unpause workspace' : 'Pause workspace'}
              </button>
            </form>
          )}
        </div>
      </div>

      {/* At-a-glance */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Plan" value={workspace.plan} tone={workspace.plan === 'trial' ? 'warn' : 'good'} />
        <Stat label="Members" value={workspace.members.length} />
        <Stat label="Agents" value={workspace.agents.length} />
        <Stat label="CRM locations" value={locationCount} />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Messages (7d)" value={messages7d} />
        <Stat label="Errors (7d)" value={errors7d} tone={errors7d > 0 ? 'warn' : 'muted'} />
        <Stat label="Msg usage" value={`${workspace.messageUsage.toLocaleString()}${workspace.messageLimit > 0 ? ` / ${workspace.messageLimit.toLocaleString()}` : ''}`} />
        <Stat
          label="Voice mins"
          value={`${workspace.voiceMinuteUsage.toLocaleString()}${workspace.voiceMinuteLimit > 0 ? ` / ${workspace.voiceMinuteLimit.toLocaleString()}` : ''}`}
        />
      </section>

      {/* Platform learnings opt-out */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-medium text-zinc-200">Platform guidelines</h2>
            <p className="text-xs text-zinc-500 mt-1 max-w-xl">
              When enabled, every agent in this workspace sees the shared
              &ldquo;## Platform Guidelines&rdquo; block at runtime — the set of
              approved cross-agent learnings. Disable only if this customer needs
              complete control over their agent prompts.
            </p>
            <p className="text-[11px] text-zinc-500 mt-2">
              Status:{' '}
              {workspace.disableGlobalLearnings ? (
                <span className="text-amber-400 font-medium">disabled — opted out</span>
              ) : (
                <span className="text-emerald-400 font-medium">enabled</span>
              )}
            </p>
          </div>
          {canMutate && (
            <form action={`/api/admin/workspaces/${workspace.id}/toggle-global-learnings`} method="post">
              <button
                type="submit"
                className={`text-xs font-medium border rounded-lg px-3 py-2 transition-colors ${
                  workspace.disableGlobalLearnings
                    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20'
                    : 'text-amber-400 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20'
                }`}
              >
                {workspace.disableGlobalLearnings ? 'Enable platform guidelines' : 'Disable (opt out)'}
              </button>
            </form>
          )}
        </div>
      </section>

      {/* Billing */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Billing</h2>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-xs">
          <KV label="Billing period" value={workspace.billingPeriod} />
          <KV label="Agent limit" value={String(workspace.agentLimit)} />
          <KV label="Extra agents" value={String(workspace.extraAgentCount)} />
          <KV label="Trial ends" value={workspace.trialEndsAt?.toISOString().slice(0, 10) ?? '—'} />
          <KV label="Stripe customer" value={workspace.stripeCustomerId ?? '—'} mono />
          <KV label="Stripe subscription" value={workspace.stripeSubscriptionId ?? '—'} mono />
          <KV label="Stripe price" value={workspace.stripePriceId ?? '—'} mono />
          <KV label="Period ends" value={workspace.stripeCurrentPeriodEnd?.toISOString().slice(0, 10) ?? '—'} />
          <KV label="Paused" value={workspace.isPaused ? 'Yes' : 'No'} />
        </dl>
      </section>

      {/* Members */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Members ({workspace.members.length})</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
          {workspace.members.map(m => (
            <div key={m.id} className="px-4 py-2.5 text-xs grid grid-cols-[auto,1fr,auto] gap-4 items-center">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900 rounded px-1.5 py-0.5">
                {m.role}
              </span>
              <div>
                <div className="text-zinc-200">{m.user.name ?? '(no name)'}</div>
                <div className="text-zinc-500">{m.user.email}</div>
              </div>
              <span className="text-zinc-600 font-mono">{m.user.id.slice(-10)}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Agents */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Agents ({workspace.agents.length})</h2>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
          {workspace.agents.map(a => (
            <div key={a.id} className="px-4 py-2.5 text-xs grid grid-cols-[1fr,auto,auto,auto] gap-4 items-center">
              <div>
                <div className="text-zinc-200">{a.name}</div>
                <div className="text-zinc-600 font-mono">{a.id.slice(-10)}</div>
              </div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900 rounded px-1.5 py-0.5">
                {a.agentType}
              </span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                a.isPaused ? 'text-red-400 bg-red-500/10' :
                a.isActive ? 'text-emerald-400 bg-emerald-500/10' :
                'text-zinc-500 bg-zinc-800'
              }`}>
                {a.isPaused ? 'paused' : a.isActive ? 'active' : 'inactive'}
              </span>
              <Link
                href={`/admin/logs?agentId=${a.id}`}
                className="text-blue-400 hover:text-blue-300"
              >
                Logs →
              </Link>
            </div>
          ))}
          {workspace.agents.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-500">No agents yet.</div>
          )}
        </div>
      </section>

      {/* Recent logs */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-medium text-zinc-200">Recent logs</h2>
          <Link
            href={`/admin/logs?${new URLSearchParams({
              // The logs page filters by agentId — link to the first agent
              // or drop the filter if the workspace has none, so the link
              // still does something useful.
              ...(workspace.agents[0] ? { agentId: workspace.agents[0].id } : {}),
            }).toString()}`}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            All logs →
          </Link>
        </div>
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
          {recentLogs.map(l => (
            <div key={l.id} className="px-4 py-2.5 text-xs">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-zinc-600 font-mono">{l.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</span>
                <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${
                  l.status === 'SUCCESS' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
                  l.status === 'ERROR' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
                  'text-zinc-500 bg-zinc-800 border-zinc-700'
                }`}>
                  {l.status}
                </span>
                <span className="text-zinc-600 font-mono">ct {l.contactId.slice(-8)}</span>
              </div>
              {l.errorMessage && <div className="text-red-300 mt-1">{l.errorMessage}</div>}
              {l.inboundMessage && (
                <div className="text-zinc-400 mt-1 truncate">
                  {l.inboundMessage.slice(0, 160)}{l.inboundMessage.length > 160 ? '…' : ''}
                </div>
              )}
            </div>
          ))}
          {recentLogs.length === 0 && (
            <div className="px-4 py-8 text-center text-zinc-500">No logs yet.</div>
          )}
        </div>
      </section>

      <p className="text-[10px] text-zinc-600 pt-4">
        Created {workspace.createdAt.toISOString().slice(0, 10)}
        {workspace.isPaused && workspace.pausedAt && ` · paused ${workspace.pausedAt.toISOString().slice(0, 10)}`}
      </p>
    </div>
  )
}

function Stat({ label, value, tone = 'default' }: { label: string; value: string | number; tone?: 'default' | 'good' | 'warn' | 'muted' }) {
  const tint =
    tone === 'good' ? 'border-emerald-500/30 bg-emerald-500/[0.04]' :
    tone === 'warn' ? 'border-amber-500/40 bg-amber-500/[0.05]' :
    'border-zinc-800 bg-zinc-950'
  return (
    <div className={`rounded-lg border p-4 ${tint}`}>
      <p className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold text-zinc-100 mt-1">{value}</p>
    </div>
  )
}

function KV({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className={`text-zinc-200 ${mono ? 'font-mono text-[11px]' : ''}`}>{value}</dd>
    </div>
  )
}
