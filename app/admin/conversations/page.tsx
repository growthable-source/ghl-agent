import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Search = Promise<{ workspace?: string; agent?: string; q?: string }>

/**
 * Cross-workspace conversation browser — admin-only.
 *
 * Source of truth is ConversationStateRecord — it already has exactly
 * one row per (agentId, contactId) with an updatedAt we can order by,
 * which sidesteps the costly groupBy over ConversationMessage we used
 * to do here. Also avoids Prisma's relation-filter-in-groupBy
 * limitation, which would bite us as soon as a workspace filter was
 * applied.
 *
 * Everything is wrapped in a soft-fail block: if the admin-reviews
 * table (or any future additive table) isn't present yet because
 * migrations haven't run, we render the page with degraded data rather
 * than 500ing. Makes first-time-after-deploy navigation survive the
 * race window.
 */
export default async function AdminConversationsPage({ searchParams }: { searchParams: Search }) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const workspaceFilter = sp.workspace?.trim() || ''
  const agentFilter = sp.agent?.trim() || ''
  const search = sp.q?.trim() || ''

  let errorBanner: string | null = null

  // Dropdown data — always safe, no migration dependency.
  const [workspaces, agentsForDropdown] = await Promise.all([
    db.workspace.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as Array<{ id: string; name: string }>),
    db.agent.findMany({
      where: workspaceFilter
        ? {
            OR: [
              { workspaceId: workspaceFilter },
              { location: { workspaceId: workspaceFilter } },
            ],
          }
        : undefined,
      select: { id: true, name: true, workspaceId: true, locationId: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as Array<{ id: string; name: string; workspaceId: string | null; locationId: string }>),
  ])

  // If workspace is filtered, pre-resolve the allowed agent IDs up front
  // so the main query only needs a scalar { agentId: { in } } filter.
  // Keeps the ConversationStateRecord query planner-friendly.
  const allowedAgentIds = workspaceFilter
    ? agentsForDropdown.map(a => a.id)
    : null

  // Main query: one row per active (agentId, contactId) pair.
  let states: Array<{
    agentId: string
    contactId: string
    locationId: string
    conversationId: string | null
    messageCount: number
    state: string
    updatedAt: Date
  }> = []
  try {
    states = await db.conversationStateRecord.findMany({
      where: {
        ...(agentFilter ? { agentId: agentFilter } : {}),
        ...(allowedAgentIds !== null
          ? { agentId: { in: allowedAgentIds.length > 0 ? allowedAgentIds : ['__none__'] } }
          : {}),
        ...(search ? { contactId: { contains: search } } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        agentId: true,
        contactId: true,
        locationId: true,
        conversationId: true,
        messageCount: true,
        state: true,
        updatedAt: true,
      },
    })
  } catch (e: any) {
    // Prisma wraps "relation does not exist" into a P2021 error. Show a
    // clear hint rather than the generic Next error page.
    errorBanner = `Failed to load conversations: ${e?.message ?? 'unknown'}. If you just deployed, run migrations (\`npm run db:migrate:deploy\`).`
  }

  const agentIds = Array.from(new Set(states.map(s => s.agentId)))
  const contactIds = Array.from(new Set(states.map(s => s.contactId)))

  // Hydrate agent display data in one shot.
  const agentsById = new Map(
    (agentIds.length > 0
      ? await db.agent.findMany({
          where: { id: { in: agentIds } },
          select: {
            id: true, name: true,
            workspace: { select: { name: true } },
            location: { select: { workspace: { select: { name: true } } } },
          },
        }).catch(() => [])
      : []
    ).map(a => [a.id, a] as const),
  )

  // Last-message preview per pair. Bounded to ≤100 pairs so doing it in
  // parallel is fine — the alternative (one SQL with DISTINCT ON) would
  // be cleaner but requires a raw query, which we're avoiding here.
  const previews = await Promise.all(
    states.map(s =>
      db.conversationMessage
        .findFirst({
          where: { agentId: s.agentId, contactId: s.contactId },
          orderBy: { createdAt: 'desc' },
          select: { role: true, content: true, createdAt: true },
        })
        .catch(() => null),
    ),
  )

  // Review-count badge. Guarded because AgentReview is a newer table —
  // if the migration hasn't run yet we still want the page to render.
  let reviewCountMap = new Map<string, number>()
  if (agentIds.length > 0) {
    try {
      const rows = await db.agentReview.groupBy({
        by: ['agentId', 'contactId'],
        where: { agentId: { in: agentIds }, contactId: { in: contactIds } },
        _count: { _all: true },
      })
      reviewCountMap = new Map(
        rows.map(r => [`${r.agentId}:${r.contactId}`, r._count._all] as const),
      )
    } catch {
      // Migration not run yet — the badges just won't appear.
    }
  }

  logAdminAction({ admin: session, action: 'view_conversations_list' }).catch(() => {})

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Conversations</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Every conversation the agents have had, across all workspaces.
          Click through to review a thread with the auditor Claude.
        </p>
      </div>

      {errorBanner && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          {errorBanner}
        </div>
      )}

      {/* Filters */}
      <form className="grid grid-cols-1 md:grid-cols-[1fr,1fr,1fr,auto] gap-2" method="get">
        <select
          name="workspace"
          defaultValue={workspaceFilter}
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
        >
          <option value="">All workspaces</option>
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <select
          name="agent"
          defaultValue={agentFilter}
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200"
        >
          <option value="">All agents</option>
          {agentsForDropdown.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <input
          type="text"
          name="q"
          defaultValue={search}
          placeholder="Contact ID contains…"
          className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
        />
        <button
          type="submit"
          className="text-xs font-medium border border-zinc-700 text-zinc-200 hover:text-white hover:border-zinc-500 rounded-lg px-4 py-2 transition-colors"
        >
          Apply
        </button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-zinc-500 text-[10px] uppercase tracking-wider">
            <tr className="border-b border-zinc-800">
              <th className="text-left px-4 py-2 font-semibold">Agent</th>
              <th className="text-left px-4 py-2 font-semibold">Workspace</th>
              <th className="text-left px-4 py-2 font-semibold">Contact</th>
              <th className="text-left px-4 py-2 font-semibold">State</th>
              <th className="text-left px-4 py-2 font-semibold">Turns</th>
              <th className="text-left px-4 py-2 font-semibold">Last message</th>
              <th className="text-left px-4 py-2 font-semibold">When</th>
              <th className="text-left px-4 py-2 font-semibold">Reviews</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {states.map((s, i) => {
              const agent = agentsById.get(s.agentId)
              const preview = previews[i]
              const workspaceName = agent?.workspace?.name ?? agent?.location?.workspace?.name ?? '—'
              const reviewCount = reviewCountMap.get(`${s.agentId}:${s.contactId}`) ?? 0
              return (
                <tr key={`${s.agentId}-${s.contactId}`} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/conversations/${s.agentId}/${s.contactId}`}
                      className="text-zinc-200 hover:text-white"
                    >
                      {agent?.name ?? s.agentId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{workspaceName}</td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">{s.contactId.slice(-12)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${
                      s.state === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' :
                      s.state === 'PAUSED' ? 'bg-amber-500/10 text-amber-400' :
                      'bg-zinc-900 text-zinc-500'
                    }`}>
                      {s.state}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{s.messageCount}</td>
                  <td className="px-4 py-2.5 text-zinc-500 max-w-[420px]">
                    {preview ? (
                      <span className="truncate block">
                        <span className="text-[10px] uppercase tracking-wider text-zinc-600 mr-2">
                          {preview.role}
                        </span>
                        {preview.content.slice(0, 140)}
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">
                    {s.updatedAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="px-4 py-2.5">
                    {reviewCount > 0 ? (
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 rounded px-1.5 py-0.5">
                        {reviewCount}
                      </span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {states.length === 0 && !errorBanner && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-zinc-500">
                  No conversations match those filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-zinc-600">
        Showing up to 100 most-recent threads. Tighten filters if your workspace has more.
      </p>
    </div>
  )
}
