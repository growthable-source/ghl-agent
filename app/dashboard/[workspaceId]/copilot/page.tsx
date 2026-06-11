'use client'

/**
 * Co-Pilot — dashboard surface (staff).
 *
 * Two layers:
 *   - a picker: built-in quick-starts (General support, Guided
 *     onboarding) + the workspace's own Co-Pilot AGENTS (named
 *     personas with procedures + recording-distilled playbooks).
 *   - the live session, run as whichever was chosen.
 *
 * Choosing an agent (or ?agent=<id>) starts the session AS that
 * agent; the shared LiveSessionPanel + transport are unchanged.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'
import PastSessions from '@/components/copilot/PastSessions'

interface AgentRow {
  id: string
  name: string
  steps: string[]
  timeboxMinutes: number
  hasPlaybook: boolean
  recordingCount: number
  recordingsProcessing: number
}

type Selection = { kind: 'general' } | { kind: 'onboarding' } | { kind: 'agent'; agentId: string; name: string }

export default function CopilotPage() {
  const params = useParams<{ workspaceId: string }>()
  const search = useSearchParams()
  const workspaceId = params?.workspaceId
  const [refreshKey, setRefreshKey] = useState(0)
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [selection, setSelection] = useState<Selection>({ kind: 'general' })
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    void fetch(`/api/workspaces/${workspaceId}/copilot/agents`)
      .then(r => (r.ok ? r.json() : { agents: [] }))
      .then(d => setAgents(Array.isArray(d.agents) ? d.agents : []))
      .catch(() => setAgents([]))
  }, [workspaceId, refreshKey])

  // Deep-link from the editor's "Start a session as this agent".
  useEffect(() => {
    const a = search?.get('agent')
    if (a && agents.length) {
      const found = agents.find(x => x.id === a)
      if (found) setSelection({ kind: 'agent', agentId: found.id, name: found.name })
    }
  }, [search, agents])


  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const payload: Record<string, unknown> = { workspaceId, locale }
        if (selection.kind === 'agent') payload.agentId = selection.agentId
        else payload.mode = selection.kind
        const res = await fetch('/api/copilot/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const body = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, ...body }
      },
      async tool(sessionId, name, args) {
        const res = await fetch(`/api/copilot/sessions/${sessionId}/tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, args }),
        })
        const body = (await res.json().catch(() => ({}))) as { result?: string }
        return body.result ?? 'Tool execution failed.'
      },
      async events(sessionId, batch, final) {
        await fetch(`/api/copilot/sessions/${sessionId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
          ...(final ? { keepalive: true } : {}),
        })
      },
      async end(sessionId, reason) {
        const res = await fetch(`/api/copilot/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endedReason: reason }),
          keepalive: true,
        })
        const body = await res.json().catch(() => ({}))
        return {
          durationSecs: typeof body.durationSecs === 'number' ? body.durationSecs : 0,
          goalReached: typeof body.taskSuccess === 'boolean' ? body.taskSuccess : null,
        }
      },
    }),
    [workspaceId, selection],
  )

  const onSessionEnded = useCallback(() => {
    setRefreshKey(k => k + 1)
    setStarted(false)
  }, [])

  if (!workspaceId) return null

  const selLabel =
    selection.kind === 'agent' ? selection.name : selection.kind === 'onboarding' ? 'Guided onboarding' : 'General support'

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-zinc-100 mb-2">Co-Pilot</h1>
        <p className="text-zinc-400 leading-relaxed max-w-2xl">
          Build live screen-share agents — support, onboarding, or anything else — teach them from recordings and
          SOPs, then deploy them via link, button, or JavaScript snippet. Pick one below to run a session right here.
        </p>
      </div>

      {/* Picker — hidden once a session starts. */}
      {!started && (
        <div className="mb-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <PickTile
              active={selection.kind === 'general'}
              onClick={() => setSelection({ kind: 'general' })}
              title="General support"
              body="Fix anything — diagnose and solve whatever comes up."
            />
            <PickTile
              active={selection.kind === 'onboarding'}
              onClick={() => setSelection({ kind: 'onboarding' })}
              title="Guided onboarding"
              body="Walk the built-in publish-your-first-agent workflow."
            />
            {agents.map(a => (
              <PickTile
                key={a.id}
                active={selection.kind === 'agent' && selection.agentId === a.id}
                onClick={() => setSelection({ kind: 'agent', agentId: a.id, name: a.name })}
                title={a.name}
                body={
                  a.steps.length
                    ? `${a.steps.length}-step procedure · ${a.timeboxMinutes} min`
                    : 'General expert'
                }
                badge={
                  a.recordingsProcessing > 0
                    ? 'learning…'
                    : a.hasPlaybook
                      ? `trained · ${a.recordingCount} call${a.recordingCount === 1 ? '' : 's'}`
                      : undefined
                }
                href={`/dashboard/${workspaceId}/copilot/agents/${a.id}`}
              />
            ))}
            <Link
              href={`/dashboard/${workspaceId}/copilot/new`}
              className="rounded-xl border border-dashed border-zinc-700 p-4 text-left hover:bg-zinc-900/40 transition-colors block"
            >
              <p className="text-sm font-medium text-zinc-300">+ New Co-Pilot agent</p>
              <p className="text-xs text-zinc-500 mt-0.5">A named persona with its own steps, knowledge, and learned playbook.</p>
            </Link>
          </div>
        </div>
      )}

      {/* When idle, LiveSessionPanel shows its own start button; we just
          tell the user which co-pilot will answer. */}
      {!started && (
        <p className="text-xs text-zinc-500 mb-2">
          Starting as <span className="text-zinc-300 font-medium">{selLabel}</span>.
        </p>
      )}

      <LiveSessionPanel
        key={selection.kind === 'agent' ? selection.agentId : selection.kind}
        transport={transport}
        endedGoalCopy={goal =>
          goal === null
            ? null
            : goal
              ? '✓ Goal reached during this session'
              : 'Not fully resolved — pick up where you left off any time'
        }
        onSessionEnded={onSessionEnded}
        onSessionStarted={() => setStarted(true)}
      />

      <PastSessions workspaceId={workspaceId} refreshKey={refreshKey} />
    </div>
  )
}

function PickTile({
  active,
  onClick,
  title,
  body,
  badge,
  href,
}: {
  active: boolean
  onClick: () => void
  title: string
  body: string
  badge?: string
  href?: string
}) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl border p-4 cursor-pointer transition-colors"
      style={
        active
          ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
          : { borderColor: 'var(--border-secondary)', background: 'var(--surface)' }
      }
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-zinc-100">{title}</p>
        {badge && (
          <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-emerald-bg text-accent-emerald">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-zinc-400 mt-1">{body}</p>
      {href && (
        <Link
          href={href}
          onClick={e => e.stopPropagation()}
          className="inline-block mt-2 text-xs font-medium"
          style={{ color: 'var(--accent-primary)' }}
        >
          Edit / teach →
        </Link>
      )}
    </div>
  )
}
