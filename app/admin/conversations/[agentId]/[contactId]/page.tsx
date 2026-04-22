import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, logAdminAction } from '@/lib/admin-auth'
import ReviewChat from '@/components/admin/ReviewChat'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ agentId: string; contactId: string }> }

/**
 * Single-conversation audit view. Left column = full transcript +
 * agent configuration summary (system prompt, rules, persona). Right
 * column = review chat with meta-Claude, persisted as AgentReview rows.
 *
 * Admin-only, 2FA-gated. Designed to be the "share this thread with
 * the brain and tell it what went wrong" surface.
 */
export default async function AdminConversationReviewPage({ params }: Params) {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  const { agentId, contactId } = await params

  const agent = await db.agent.findUnique({
    where: { id: agentId },
    select: {
      id: true,
      name: true,
      systemPrompt: true,
      agentType: true,
      businessContext: true,
      agentPersonaName: true,
      responseLength: true,
      formalityLevel: true,
      useEmojis: true,
      fallbackBehavior: true,
      fallbackMessage: true,
      workspaceId: true,
      location: { select: { workspaceId: true, workspace: { select: { id: true, name: true } } } },
      workspace: { select: { id: true, name: true } },
      detectionRules: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, conditionDescription: true },
      },
      listeningRules: {
        where: { isActive: true },
        orderBy: { order: 'asc' },
        select: { id: true, name: true, description: true },
      },
      qualifyingQuestions: {
        // QualifyingQuestion has no isActive flag — all rows are live.
        orderBy: { order: 'asc' },
        select: { id: true, question: true, fieldKey: true },
      },
    },
  })
  if (!agent) notFound()

  const messages = await db.conversationMessage.findMany({
    where: { agentId, contactId },
    orderBy: { createdAt: 'asc' },
    take: 500,  // cap at 500 turns — any thread that long is a novel, not a conversation
    select: { id: true, role: true, content: true, createdAt: true },
  })
  if (messages.length === 0) notFound()

  // The linked approval/status history from MessageLog so the reviewer
  // can cross-reference "this message was auto-sent" vs "this was queued
  // for approval". Keyed loosely by createdAt proximity — not perfect,
  // but enough for the operator to see flags.
  const messageLogs = await db.messageLog.findMany({
    where: { agentId, contactId },
    orderBy: { createdAt: 'asc' },
    take: 500,
    select: {
      id: true, status: true, approvalStatus: true, approvalReason: true,
      errorMessage: true, createdAt: true,
    },
  })

  // Soft-fail: if the AgentReview migration hasn't run yet (fresh
  // deploy, dev env that hasn't applied the new SQL), the table won't
  // exist — we still want the transcript + review chat to work.
  const existingReviews = await db.agentReview.findMany({
    where: { agentId, contactId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: {
      id: true, title: true, adminEmail: true, messages: true, createdAt: true,
    },
  }).catch(() => [] as Array<{
    id: string
    title: string | null
    adminEmail: string
    messages: unknown
    createdAt: Date
  }>)

  const workspaceName = agent.workspace?.name ?? agent.location?.workspace?.name ?? '—'
  const workspaceId = agent.workspace?.id ?? agent.location?.workspace?.id ?? null

  logAdminAction({
    admin: session,
    action: 'view_conversation_review',
    target: `${agentId}:${contactId}`,
  }).catch(() => {})

  return (
    <div className="p-6 space-y-4">
      <div>
        <Link href="/admin/conversations" className="text-xs text-zinc-500 hover:text-white">
          ← All conversations
        </Link>
        <div className="flex items-center justify-between gap-4 mt-2 flex-wrap">
          <div>
            <h1 className="text-lg font-semibold">
              {agent.name}
              <span className="text-zinc-500 text-sm font-normal"> → contact {contactId.slice(-10)}</span>
            </h1>
            <p className="text-xs text-zinc-500 mt-1">
              {workspaceName}
              {workspaceId && (
                <>
                  {' · '}
                  <Link href={`/admin/workspaces/${workspaceId}`} className="underline decoration-zinc-700 hover:decoration-zinc-400">
                    workspace
                  </Link>
                </>
              )}
              {' · '}{messages.length} turn{messages.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr,420px] gap-4">
        {/* LEFT: transcript + agent config */}
        <div className="space-y-4">
          {/* Agent config snapshot */}
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
            <h2 className="text-sm font-medium text-zinc-200">Agent configuration</h2>
            <div className="text-xs space-y-2">
              <Field label="Type">{agent.agentType}</Field>
              <Field label="Persona">{agent.agentPersonaName ?? '—'} · {agent.formalityLevel} · replies {agent.responseLength}{agent.useEmojis ? ' · emojis' : ''}</Field>
              <Field label="Fallback">{agent.fallbackBehavior}{agent.fallbackMessage ? ` — "${agent.fallbackMessage.slice(0, 80)}"` : ''}</Field>
              {agent.businessContext && (
                <Field label="Business context">
                  <span className="text-zinc-400 whitespace-pre-wrap">{agent.businessContext.slice(0, 400)}{agent.businessContext.length > 400 ? '…' : ''}</span>
                </Field>
              )}
            </div>
            {agent.qualifyingQuestions.length > 0 && (
              <details>
                <summary className="text-xs text-zinc-400 cursor-pointer hover:text-white">
                  Qualifying questions ({agent.qualifyingQuestions.length})
                </summary>
                <ul className="mt-2 text-[11px] text-zinc-500 space-y-0.5 pl-4 list-disc">
                  {agent.qualifyingQuestions.map(q => (
                    <li key={q.id}>
                      <span className="font-mono text-zinc-600">{q.fieldKey}</span> — {q.question}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {agent.detectionRules.length > 0 && (
              <details>
                <summary className="text-xs text-zinc-400 cursor-pointer hover:text-white">
                  Detection rules ({agent.detectionRules.length})
                </summary>
                <ul className="mt-2 text-[11px] text-zinc-500 space-y-0.5 pl-4 list-disc">
                  {agent.detectionRules.map(r => (
                    <li key={r.id}><span className="text-zinc-300">{r.name}</span> — {r.conditionDescription}</li>
                  ))}
                </ul>
              </details>
            )}
            {agent.listeningRules.length > 0 && (
              <details>
                <summary className="text-xs text-zinc-400 cursor-pointer hover:text-white">
                  Listening rules ({agent.listeningRules.length})
                </summary>
                <ul className="mt-2 text-[11px] text-zinc-500 space-y-0.5 pl-4 list-disc">
                  {agent.listeningRules.map(r => (
                    <li key={r.id}><span className="text-zinc-300">{r.name}</span> — {r.description}</li>
                  ))}
                </ul>
              </details>
            )}
            <details>
              <summary className="text-xs text-zinc-400 cursor-pointer hover:text-white">System prompt</summary>
              <pre className="mt-2 text-[11px] text-zinc-500 whitespace-pre-wrap font-mono bg-zinc-900/50 p-3 rounded border border-zinc-800 max-h-80 overflow-auto">
                {agent.systemPrompt}
              </pre>
            </details>
          </section>

          {/* Transcript */}
          <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
            <h2 className="text-sm font-medium text-zinc-200 mb-3">Transcript</h2>
            <ol className="space-y-3">
              {messages.map((m, i) => {
                const isUser = m.role === 'user'
                // Try to find a MessageLog created near this outbound turn for
                // status badges; not exact but close enough for at-a-glance.
                const nearestLog = !isUser
                  ? messageLogs.find(l =>
                      Math.abs(l.createdAt.getTime() - m.createdAt.getTime()) < 30_000,
                    )
                  : null
                return (
                  <li key={m.id} className={`flex ${isUser ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                      isUser
                        ? 'bg-zinc-900 border border-zinc-800 text-zinc-200'
                        : 'bg-blue-500/10 border border-blue-500/30 text-blue-50'
                    }`}>
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider mb-1">
                        <span className={isUser ? 'text-zinc-500' : 'text-blue-300/80'}>
                          {isUser ? 'Contact' : 'Agent'}
                        </span>
                        <span className="text-zinc-600 font-mono">
                          {m.createdAt.toISOString().slice(11, 19)}
                        </span>
                        <span className="text-zinc-700 font-mono">
                          turn {i + 1}
                        </span>
                        {nearestLog?.approvalStatus === 'pending' && (
                          <span className="text-amber-400">queued for approval</span>
                        )}
                        {nearestLog?.status === 'ERROR' && (
                          <span className="text-red-400">error</span>
                        )}
                      </div>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                      {nearestLog?.errorMessage && (
                        <div className="mt-1 text-[11px] text-red-300">{nearestLog.errorMessage}</div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>

          {/* Past reviews */}
          {existingReviews.length > 0 && (
            <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
              <h2 className="text-sm font-medium text-zinc-200 mb-3">Past reviews</h2>
              <div className="space-y-2">
                {existingReviews.map(r => {
                  const msgs = (Array.isArray(r.messages) ? r.messages : []) as Array<{ role: string; content: string }>
                  return (
                    <details key={r.id} className="rounded border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
                      <summary className="cursor-pointer flex items-center gap-2 flex-wrap">
                        <span className="text-zinc-200">{r.title ?? 'Untitled review'}</span>
                        <span className="text-zinc-600 font-mono text-[10px]">{r.adminEmail}</span>
                        <span className="text-zinc-600 font-mono text-[10px] ml-auto">
                          {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                        </span>
                      </summary>
                      <ol className="mt-3 space-y-2">
                        {msgs.map((m, i) => (
                          <li key={i} className={m.role === 'admin' ? 'text-zinc-300' : 'text-blue-100'}>
                            <span className="text-[10px] uppercase tracking-wider text-zinc-500 mr-2">
                              {m.role === 'admin' ? 'You' : 'Reviewer'}
                            </span>
                            <span className="whitespace-pre-wrap">{m.content}</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )
                })}
              </div>
            </section>
          )}
        </div>

        {/* RIGHT: review chat */}
        <div className="xl:sticky xl:top-4 xl:self-start">
          <ReviewChat
            agentId={agentId}
            contactId={contactId}
            agentName={agent.name}
          />
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px,1fr] gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-zinc-300">{children}</dd>
    </div>
  )
}
