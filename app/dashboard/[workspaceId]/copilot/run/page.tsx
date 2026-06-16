'use client'

/**
 * Run a Co-Pilot session — the dedicated session surface.
 *
 * /copilot is the agent LIST (build + manage); this page is where a
 * session actually runs. Reached from an agent's "Start session"
 * button (?agent=<id>) or the built-in quick-starts (?mode=general|
 * onboarding). One click here (the screen-share button — a browser
 * user-gesture requirement, it can't be auto-fired) and you're live
 * as that agent. No gallery detour.
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'

export default function CopilotRunPage() {
  const params = useParams<{ workspaceId: string }>()
  const search = useSearchParams()
  const workspaceId = params?.workspaceId
  const agentId = search?.get('agent') ?? null
  const mode = search?.get('mode') === 'onboarding' ? 'onboarding' : 'general'

  const [agentName, setAgentName] = useState<string | null>(null)

  useEffect(() => {
    if (!workspaceId || !agentId) return
    void fetch(`/api/workspaces/${workspaceId}/copilot/agents/${agentId}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setAgentName(d?.agent?.name ?? null))
      .catch(() => setAgentName(null))
  }, [workspaceId, agentId])

  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const payload: Record<string, unknown> = { workspaceId, locale }
        if (agentId) payload.agentId = agentId
        else payload.mode = mode
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
    [workspaceId, agentId, mode],
  )

  if (!workspaceId) return null

  const title = agentId
    ? (agentName ?? 'Co-Pilot session')
    : mode === 'onboarding'
      ? 'Guided onboarding'
      : 'General support'

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 w-full">
      <div className="mb-6">
        <Link href={`/dashboard/${workspaceId}/copilot`} className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Co-Pilot agents
        </Link>
        <h1 className="text-3xl font-semibold text-zinc-100 mt-3">{title}</h1>
      </div>

      <LiveSessionPanel
        key={agentId ?? mode}
        transport={transport}
        // Proactive leader mode is wired to the onboarding prompt
        // (buildCopilotSystemPrompt), which explains the screen cues. The
        // general-support and per-agent prompts don't, so leave them reactive.
        proactive={!agentId && mode === 'onboarding'}
        idleTitle={agentId ? `Start your session with ${agentName ?? 'this agent'}` : 'Start a live help session'}
        endedGoalCopy={goal =>
          goal === null
            ? null
            : goal
              ? '✓ Goal reached during this session'
              : 'Not fully resolved — pick up where you left off any time'
        }
      />
    </div>
  )
}
