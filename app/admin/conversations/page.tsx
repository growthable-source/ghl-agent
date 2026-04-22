import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

type Search = Promise<{ workspace?: string; agent?: string; q?: string }>

/**
 * Cross-workspace conversation browser — admin-only. Lists the most
 * recent (agent, contact) pairs by latest ConversationMessage activity
 * so ops can drill into a specific thread and review it with the meta-
 * Claude auditor.
 *
 * The heavy lifting (filter by workspace / agent, search by contactId)
 * is done server-side via Prisma indexes; pagination is a simple
 * "most-recent 100" cap for now — we'll add cursoring once someone
 * actually hits the limit.
 */
export default async function AdminConversationsPage({ searchParams }: { searchParams: Search }) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const workspaceFilter = sp.workspace?.trim() || ''
  const agentFilter = sp.agent?.trim() || ''
  const search = sp.q?.trim() || ''

  // Fetch workspaces + agents for the filter dropdowns. Bounded counts so a
  // huge tenant count doesn't blow out the page.
  const [workspaces, agents] = await Promise.all([
    db.workspace.findMany({
      select: { id: true, name: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
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
    }),
  ])

  // Build a (agentId, contactId) list by scanning recent ConversationMessage
  // rows. Grouping in Postgres returns the latest timestamp per pair so we
  // can order by recency without loading every message.
  const recent = await db.conversationMessage.groupBy({
    by: ['agentId', 'contactId', 'conversationId', 'locationId'],
    where: {
      ...(agentFilter ? { agentId: agentFilter } : {}),
      ...(search ? { contactId: { contains: search } } : {}),
      ...(workspaceFilter && !agentFilter
        ? {
            agent: {
              OR: [
                { workspaceId: workspaceFilter },
                { location: { workspaceId: workspaceFilter } },
              ],
            },
          }
        : {}),
    },
    _max: { createdAt: true },
    _count: { _all: true },
    orderBy: { _max: { createdAt: 'desc' } },
    take: 100,
  })

  // Hydrate agent + contact + last-message previews in a batched second
  // query. Keeps the groupBy narrow while still letting us render names.
  const agentIds = Array.from(new Set(recent.map(r => r.agentId)))
  const agentsById = new Map(
    (await db.agent.findMany({
      where: { id: { in: agentIds } },
      select: {
        id: true, name: true, workspaceId: true,
        location: { select: { workspaceId: true, workspace: { select: { name: true } } } },
        workspace: { select: { name: true } },
      },
    })).map(a => [a.id, a]),
  )

  // Latest message per (agentId, contactId). Doing a per-pair lookup
  // instead of a complex window function keeps the query planner happy;
  // the groupBy above already bounded us to ≤100 pairs.
  const previews = await Promise.all(
    recent.map(r =>
      db.conversationMessage.findFirst({
        where: { agentId: r.agentId, contactId: r.contactId },
        orderBy: { createdAt: 'desc' },
        select: { role: true, content: true, createdAt: true },
      }),
    ),
  )

  // Count pending reviews so we can show a small badge per conversation.
  const reviewCounts = await db.agentReview.groupBy({
    by: ['agentId', 'contactId'],
    where: {
      agentId: { in: agentIds },
      contactId: { in: recent.map(r => r.contactId) },
    },
    _count: { _all: true },
  })
  const reviewCountMap = new Map(
    reviewCounts.map(rc => [`${rc.agentId}:${rc.contactId}`, rc._count._all] as const),
  )

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
          {agents.map(a => (
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
              <th className="text-left px-4 py-2 font-semibold">Turns</th>
              <th className="text-left px-4 py-2 font-semibold">Last message</th>
              <th className="text-left px-4 py-2 font-semibold">When</th>
              <th className="text-left px-4 py-2 font-semibold">Reviews</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-900">
            {recent.map((r, i) => {
              const agent = agentsById.get(r.agentId)
              const preview = previews[i]
              const workspaceName = agent?.workspace?.name ?? agent?.location?.workspace?.name ?? '—'
              const reviewCount = reviewCountMap.get(`${r.agentId}:${r.contactId}`) ?? 0
              return (
                <tr key={`${r.agentId}-${r.contactId}`} className="hover:bg-zinc-900/40">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/admin/conversations/${r.agentId}/${r.contactId}`}
                      className="text-zinc-200 hover:text-white"
                    >
                      {agent?.name ?? r.agentId}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-zinc-400">{workspaceName}</td>
                  <td className="px-4 py-2.5 text-zinc-500 font-mono">{r.contactId.slice(-12)}</td>
                  <td className="px-4 py-2.5 text-zinc-400">{r._count._all}</td>
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
                    {r._max.createdAt ? r._max.createdAt.toISOString().slice(0, 16).replace('T', ' ') : '—'}
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
            {recent.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-zinc-500">
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
