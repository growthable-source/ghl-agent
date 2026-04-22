import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'
import LearningRow from '@/components/admin/LearningRow'

export const dynamic = 'force-dynamic'

type Search = Promise<{ status?: string; agent?: string }>

const STATUSES = ['proposed', 'approved', 'applied', 'rejected', 'retired'] as const
type StatusFilter = (typeof STATUSES)[number] | 'all'

/**
 * Platform-learnings approval queue.
 *
 * The heart of the feedback loop. Every proposal from the meta-Claude
 * reviewer lands here as status=proposed. Admins approve, reject, or
 * apply. Applied learnings can later be retired if they misbehave.
 *
 * PR 1: only "this_agent" scope + "prompt_addition" type. The UI is
 * already shaped for the wider PR 2 surface so we won't need a
 * redesign when global scope lands.
 */
export default async function AdminLearningsPage({ searchParams }: { searchParams: Search }) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const statusFilter: StatusFilter = (STATUSES.includes((sp.status as any)) ? sp.status : 'proposed') as StatusFilter
  const agentFilter = sp.agent?.trim() || ''

  const whereClause = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(agentFilter ? { agentId: agentFilter } : {}),
  }

  const [learnings, counts] = await Promise.all([
    db.platformLearning.findMany({
      where: whereClause,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        agent: {
          select: {
            id: true, name: true,
            workspace: { select: { id: true, name: true } },
            location: { select: { workspace: { select: { id: true, name: true } } } },
          },
        },
        sourceReview: {
          select: {
            id: true, contactId: true, agentId: true,
          },
        },
      },
    }),
    // Count per status for the tab badges. Independent of the agent
    // filter — the tabs always represent the global pipeline so the
    // operator can see "there are 12 proposed across all agents."
    db.platformLearning.groupBy({
      by: ['status'],
      _count: { _all: true },
    }),
  ])

  const countMap = new Map(counts.map(c => [c.status, c._count._all]))

  logAdminAction({ admin: session, action: 'view_learnings_queue' }).catch(() => {})

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Platform learnings</h1>
        <p className="text-sm text-zinc-500 mt-1">
          Concrete improvements proposed by the reviewer Claude during
          conversation audits. Approve to queue for application; apply to
          push the change into the target agent&apos;s system prompt.
        </p>
      </div>

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b border-zinc-800 pb-3">
        {(['proposed', 'approved', 'applied', 'rejected', 'retired', 'all'] as const).map(s => {
          const active = statusFilter === s
          const count = s === 'all' ? counts.reduce((acc, c) => acc + c._count._all, 0) : (countMap.get(s) ?? 0)
          return (
            <Link
              key={s}
              href={{ pathname: '/admin/learnings', query: { status: s, ...(agentFilter ? { agent: agentFilter } : {}) } }}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors flex items-center gap-2 ${
                active
                  ? 'bg-zinc-900 text-white border border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              <span className="capitalize">{s}</span>
              {count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  s === 'proposed' && count > 0 ? 'bg-amber-500/20 text-amber-300' :
                  s === 'applied' ? 'bg-emerald-500/20 text-emerald-300' :
                  'bg-zinc-800 text-zinc-500'
                }`}>
                  {count}
                </span>
              )}
            </Link>
          )
        })}
      </div>

      <div className="space-y-3">
        {learnings.map(l => {
          const workspaceName = l.agent?.workspace?.name ?? l.agent?.location?.workspace?.name ?? '—'
          const workspaceId = l.agent?.workspace?.id ?? l.agent?.location?.workspace?.id ?? null
          return (
            <LearningRow
              key={l.id}
              learning={{
                id: l.id,
                status: l.status,
                type: l.type,
                title: l.title,
                content: l.content,
                rationale: l.rationale,
                agentId: l.agentId,
                agentName: l.agent?.name ?? null,
                workspaceId,
                workspaceName,
                proposedByEmail: l.proposedByEmail,
                approvedByEmail: l.approvedByEmail,
                rejectedByEmail: l.rejectedByEmail,
                rejectedReason: l.rejectedReason,
                appliedAt: l.appliedAt?.toISOString() ?? null,
                createdAt: l.createdAt.toISOString(),
                sourceReviewId: l.sourceReviewId,
                sourceContactId: l.sourceReview?.contactId ?? null,
              }}
            />
          )
        })}
        {learnings.length === 0 && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-500 text-sm">
            No learnings in this bucket yet.
          </div>
        )}
      </div>

      <p className="text-[10px] text-zinc-600 pt-4">
        Showing up to 200 rows. Currently supports prompt additions scoped
        to a single agent; global platform-wide learnings land in PR 2.
      </p>
    </div>
  )
}
