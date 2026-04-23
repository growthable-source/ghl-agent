import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import SimulationAutoRefresh from '@/components/dashboard/SimulationAutoRefresh'
import SimulationLearningCard from '@/components/dashboard/SimulationLearningCard'
import { workspaceRoleHas, type WorkspaceRole } from '@/lib/require-workspace-role'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string; id: string }> }

interface Turn {
  role: 'persona' | 'agent'
  content: string
  at: string
  toolCalls?: Array<{ tool: string; input: unknown; output: string }>
}

/**
 * Simulation detail view. Shows the full transcript, the auto-review
 * summary (if any), and links out to the learnings the review proposed.
 *
 * Running sims don't poll here — the API is synchronous, so by the time
 * the client redirects to this page the sim is already complete. If
 * someone lands here mid-run (via direct URL), they'll see status=running
 * and can refresh.
 */
export default async function SimulationDetail({ params }: Params) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const { workspaceId, id } = await params

  const sim = await db.simulation.findFirst({
    where: { id, workspaceId },
    include: { agent: { select: { id: true, name: true } } },
  })
  if (!sim) notFound()

  // Role gate for the Retire button on learning cards. Owners + admins
  // can roll back an auto-applied learning; members see it read-only.
  // Members who got here have workspace access; the Retire button is
  // just gated on role at the UI layer and re-checked server-side.
  const member = await db.workspaceMember.findUnique({
    where: { userId_workspaceId: { userId: session.user.id, workspaceId } },
    select: { role: true },
  })
  const role: WorkspaceRole = member?.role === 'owner' || member?.role === 'admin' || member?.role === 'member'
    ? member.role as WorkspaceRole
    : 'member'
  const canManageLearnings = workspaceRoleHas(role, 'admin')

  const transcript = Array.isArray(sim.transcript) ? (sim.transcript as unknown as Turn[]) : []

  // Pull the auto-review + its proposed learnings so we can render them
  // right here on the simulation page. The admin-side /admin/learnings
  // is the canonical queue, but customer-facing approve/reject is a
  // follow-up feature — for now we show-and-link.
  const review = sim.reviewId
    ? await db.agentReview.findUnique({
        where: { id: sim.reviewId },
        select: { id: true, messages: true, createdAt: true, title: true },
      })
    : null

  const learnings = sim.reviewId
    ? await db.platformLearning.findMany({
        where: { sourceReviewId: sim.reviewId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, scope: true, type: true, title: true, content: true,
          rationale: true, status: true,
        },
      })
    : []

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <SimulationAutoRefresh status={sim.status} />
      <div>
        <Link href={`/dashboard/${workspaceId}/simulations`} className="text-xs text-zinc-500 hover:text-white">
          ← Simulations
        </Link>
        <div className="flex items-center gap-3 flex-wrap mt-2">
          <h1 className="text-xl font-semibold">{sim.agent?.name ?? sim.agentId}</h1>
          <StatusChip status={sim.status} />
        </div>
        <p className="text-xs text-zinc-500 mt-1">
          <span className="text-[10px] uppercase tracking-wider text-zinc-600 mr-1">{sim.style.replace(/_/g, ' ')}</span>
          · {sim.channel}
          · {sim.turnCount} turn{sim.turnCount === 1 ? '' : 's'}
          · <span className="font-mono">{sim.createdAt.toISOString().slice(0, 16).replace('T', ' ')}</span>
        </p>
        {sim.goal && <p className="text-xs text-zinc-500 mt-0.5">Goal: <span className="text-zinc-400">{sim.goal}</span></p>}
      </div>

      {sim.status === 'failed' && sim.errorMessage && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-300">
          Simulation failed: {sim.errorMessage}
        </div>
      )}

      {(sim.status === 'running' || sim.status === 'queued') && (
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3 text-sm text-blue-300 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          {sim.status === 'queued' ? 'Queued — waiting for the processor to pick it up…' : 'Running — new turns appear as the conversation unfolds (auto-refreshing).'}
        </div>
      )}

      {/* Persona brief */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <h2 className="text-sm font-medium text-zinc-200 mb-2">Persona</h2>
        <p className="text-xs text-zinc-400 whitespace-pre-wrap">{sim.personaContext}</p>
      </section>

      {/* Transcript */}
      <section>
        <h2 className="text-sm font-medium text-zinc-200 mb-3">Transcript</h2>
        <ol className="space-y-3">
          {transcript.map((t, i) => (
            <li key={i} className={`flex ${t.role === 'persona' ? 'justify-start' : 'justify-end'}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                t.role === 'persona'
                  ? 'bg-zinc-900 border border-zinc-800 text-zinc-200'
                  : 'bg-blue-500/10 border border-blue-500/30 text-blue-50'
              }`}>
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider mb-1 opacity-70">
                  <span>{t.role === 'persona' ? 'Persona' : 'Agent'}</span>
                  <span className="font-mono">turn {i + 1}</span>
                </div>
                <div className="whitespace-pre-wrap">{t.content}</div>
                {t.toolCalls && t.toolCalls.length > 0 && (
                  <details className="mt-2 text-[11px] opacity-75">
                    <summary className="cursor-pointer">
                      {t.toolCalls.length} tool call{t.toolCalls.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-1 pl-3 space-y-0.5">
                      {t.toolCalls.map((tc, j) => (
                        <li key={j} className="font-mono">• {tc.tool}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </li>
          ))}
          {transcript.length === 0 && (
            <li className="text-sm text-zinc-500 p-8 text-center">No turns yet.</li>
          )}
        </ol>
      </section>

      {/* Auto-review + proposed learnings */}
      {review && (
        <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.03] p-4 space-y-3">
          <h2 className="text-sm font-medium text-zinc-200">
            Auto-review
            {learnings.length > 0 && (() => {
              // Label reflects the pipeline's actual disposition: applied
              // (the happy path for user sims), proposed (rare — if a
              // non-user sim or an auto-apply failure), mixed otherwise.
              const appliedCount = learnings.filter(l => l.status === 'applied').length
              const label = appliedCount === learnings.length
                ? `${learnings.length} applied`
                : appliedCount === 0
                  ? `${learnings.length} proposed`
                  : `${appliedCount}/${learnings.length} applied`
              const chipCls = appliedCount === learnings.length
                ? 'text-emerald-300 bg-emerald-500/10'
                : 'text-amber-300 bg-amber-500/10'
              return (
                <span className={`ml-2 text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${chipCls}`}>
                  {label}
                </span>
              )
            })()}
          </h2>
          <ReviewProse messages={review.messages} />
          {learnings.length > 0 && (
            <div className="space-y-2">
              {learnings.map(l => (
                <SimulationLearningCard
                  key={l.id}
                  learning={l}
                  workspaceId={workspaceId}
                  canManage={canManageLearnings}
                />
              ))}
              <p className="text-[11px] text-zinc-500 pt-1">
                Agent-level improvements apply automatically to your agent&apos;s
                prompt. Click Retire on any of them if it didn&apos;t land right.
              </p>
            </div>
          )}
          {learnings.length === 0 && (
            <p className="text-xs text-zinc-500">
              The reviewer saw no issues worth flagging. Your agent handled this one well.
            </p>
          )}
        </section>
      )}

      {!review && sim.status === 'complete' && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-500">
          Auto-review didn&apos;t run on this simulation.
        </section>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'complete' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
    status === 'running' ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' :
    status === 'queued' ? 'text-zinc-400 bg-zinc-800 border-zinc-700' :
    status === 'failed' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
    'text-zinc-500 bg-zinc-900 border-zinc-800'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${cls}`}>
      {status}
    </span>
  )
}

function ReviewProse({ messages }: { messages: unknown }) {
  // messages is the AgentReview JSON — we render the assistant's prose
  // (ignoring the synthetic admin prompt we injected at auto-review time).
  if (!Array.isArray(messages)) return null
  const assistantMsg = messages.find((m: any) => m?.role === 'assistant')
  if (!assistantMsg || typeof assistantMsg.content !== 'string') return null
  return <p className="text-sm text-zinc-300 whitespace-pre-wrap">{assistantMsg.content}</p>
}
