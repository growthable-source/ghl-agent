import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'
import LearningRow from '@/components/admin/LearningRow'

export const dynamic = 'force-dynamic'

type Search = Promise<{ status?: string; agent?: string; scope?: string }>

const STATUSES = ['proposed', 'approved', 'applied', 'rejected', 'retired'] as const
type StatusFilter = (typeof STATUSES)[number] | 'all'
const SCOPES = ['this_agent', 'workspace', 'all_agents'] as const
type ScopeFilter = (typeof SCOPES)[number] | 'all'

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
  const scopeFilter: ScopeFilter = (SCOPES.includes((sp.scope as any)) ? sp.scope : 'all') as ScopeFilter
  const agentFilter = sp.agent?.trim() || ''

  const whereClause = {
    ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
    ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}),
    ...(agentFilter ? { agentId: agentFilter } : {}),
  }

  // Soft-fail both queries if the PlatformLearning migration hasn't
  // applied yet (dev env, pre-deploy window). Show an empty queue with
  // an instructional banner rather than a generic crash.
  let migrationError: string | null = null
  type LearningRow = Awaited<ReturnType<typeof db.platformLearning.findMany<{
    include: {
      agent: {
        select: {
          id: true; name: true;
          workspace: { select: { id: true; name: true } };
          location: { select: { workspace: { select: { id: true; name: true } } } };
        };
      };
      sourceReview: { select: { id: true; contactId: true; agentId: true } };
    };
  }>>>[number] & { _workspaceName?: string | null }
  type CountRow = { status: string; _count: { _all: number } }
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
    }).then(async rows => {
      // Hydrate workspaceId → workspace.name for rows that aren't linked
      // through an agent (workspace and all_agents scopes). One query,
      // not N, so the page stays snappy.
      const missingWorkspaceIds = Array.from(new Set(
        rows
          .filter(r => !r.agent && r.workspaceId)
          .map(r => r.workspaceId!),
      ))
      if (missingWorkspaceIds.length === 0) return rows
      const wsRows = await db.workspace.findMany({
        where: { id: { in: missingWorkspaceIds } },
        select: { id: true, name: true },
      })
      const wsMap = new Map(wsRows.map(w => [w.id, w.name]))
      return rows.map(r => ({
        ...r,
        // Attach a synthetic workspaceName for rendering. The row type is
        // unchanged from Prisma's perspective; we just pass through.
        _workspaceName: r.agent
          ? (r.agent.workspace?.name ?? r.agent.location?.workspace?.name ?? null)
          : (r.workspaceId ? wsMap.get(r.workspaceId) ?? null : null),
      }))
    }).catch((e: any) => {
      migrationError = `Learnings queue unavailable: ${e?.message ?? 'unknown'}. If you just deployed, run migrations (\`npm run db:migrate:deploy\`).`
      return [] as LearningRow[]
    }),
    // Count per status for the tab badges. Independent of the agent
    // filter — the tabs always represent the global pipeline so the
    // operator can see "there are 12 proposed across all agents."
    db.platformLearning.groupBy({
      by: ['status'],
      _count: { _all: true },
    }).catch((e: any) => {
      migrationError = `Learnings queue unavailable: ${e?.message ?? 'unknown'}. If you just deployed, run migrations (\`npm run db:migrate:deploy\`).`
      return [] as CountRow[]
    }),
  ]) as [LearningRow[], CountRow[]]

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

      {migrationError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300">
          {migrationError}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex items-center gap-2 flex-wrap border-b border-zinc-800 pb-3">
        {(['proposed', 'approved', 'applied', 'rejected', 'retired', 'all'] as const).map(s => {
          const active = statusFilter === s
          const count = s === 'all' ? counts.reduce((acc, c) => acc + c._count._all, 0) : (countMap.get(s) ?? 0)
          return (
            <Link
              key={s}
              href={{ pathname: '/admin/learnings', query: { status: s, ...(scopeFilter !== 'all' ? { scope: scopeFilter } : {}), ...(agentFilter ? { agent: agentFilter } : {}) } }}
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

      {/* Scope filter — secondary row */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        <span className="text-zinc-600 uppercase tracking-wider">Scope:</span>
        {(['all', 'this_agent', 'workspace', 'all_agents'] as const).map(s => {
          const active = scopeFilter === s
          const label = s === 'all' ? 'All scopes' : s.replace(/_/g, ' ')
          return (
            <Link
              key={s}
              href={{ pathname: '/admin/learnings', query: { status: statusFilter, ...(s !== 'all' ? { scope: s } : {}), ...(agentFilter ? { agent: agentFilter } : {}) } }}
              className={`px-2 py-1 rounded transition-colors ${
                active ? 'bg-zinc-900 text-white border border-zinc-700' : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
              }`}
            >
              {label}
            </Link>
          )
        })}
      </div>

      <div className="space-y-3">
        {learnings.map(l => {
          const wsRow = l as typeof l & { _workspaceName?: string | null }
          const workspaceName = wsRow._workspaceName ?? '—'
          const workspaceId = l.agent?.workspace?.id ?? l.agent?.location?.workspace?.id ?? l.workspaceId ?? null
          return (
            <LearningRow
              key={l.id}
              learning={{
                id: l.id,
                status: l.status,
                scope: l.scope,
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
        Showing up to 200 rows. Scope &ldquo;this_agent&rdquo; mutates one
        agent&apos;s system prompt directly. &ldquo;workspace&rdquo; and
        &ldquo;all_agents&rdquo; inject at runtime into a shared
        ## Platform Guidelines block (capped at 6,000 chars, cached 2 min).
        Workspaces that set disableGlobalLearnings opt out entirely.
      </p>
    </div>
  )
}
