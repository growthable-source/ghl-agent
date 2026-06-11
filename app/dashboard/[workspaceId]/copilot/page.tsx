'use client'

/**
 * Co-Pilot agents — the LIST page, matching /agents and /voice.
 *
 * This page is for BUILDING and managing co-pilot agents: create by
 * type, open one to edit/teach/deploy, or start a session with it
 * (which goes to the dedicated /copilot/run surface — sessions never
 * run on this page). Past sessions live below, like a call log.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import PastSessions from '@/components/copilot/PastSessions'

interface AgentRow {
  id: string
  name: string
  type: string
  published: boolean
  steps: string[]
  timeboxMinutes: number
  hasPlaybook: boolean
  recordingCount: number
  recordingsProcessing: number
}

const TYPE_LABEL: Record<string, string> = {
  support: 'Support',
  onboarding: 'Onboarding',
  other: 'Custom',
}

export default function CopilotAgentsPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!workspaceId) return
    void fetch(`/api/workspaces/${workspaceId}/copilot/agents`)
      .then(r => (r.ok ? r.json() : { agents: [] }))
      .then(d => setAgents(Array.isArray(d.agents) ? d.agents : []))
      .catch(() => setAgents([]))
      .finally(() => setLoaded(true))
  }, [workspaceId])

  if (!workspaceId) return null

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 w-full">
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-100 mb-2">Co-Pilot agents</h1>
          <p className="text-zinc-400 leading-relaxed max-w-2xl">
            Live screen-share agents that guide real calls. Create one by type, teach it from recordings and SOPs,
            then deploy it via link, button, or JavaScript snippet.
          </p>
        </div>
        <Link
          href={`/dashboard/${workspaceId}/copilot/new`}
          className="px-4 py-2.5 rounded-lg text-sm font-semibold text-white shrink-0"
          style={{ background: 'var(--accent-primary)' }}
        >
          + New agent
        </Link>
      </div>

      {/* Agent grid */}
      {loaded && agents.length === 0 && (
        <div className="rounded-xl border border-dashed border-zinc-700 p-10 text-center mb-8">
          <h2 className="text-lg font-medium text-zinc-100 mb-1">No Co-Pilot agents yet</h2>
          <p className="text-sm text-zinc-400 mb-4 max-w-md mx-auto">
            Create your first one — pick a type (support, onboarding, or custom), give it directions and an SOP,
            and teach it from recordings of your best calls.
          </p>
          <Link
            href={`/dashboard/${workspaceId}/copilot/new`}
            className="inline-block px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: 'var(--accent-primary)' }}
          >
            Create your first agent
          </Link>
        </div>
      )}

      {agents.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {agents.map(a => (
            <div
              key={a.id}
              className="rounded-xl border p-4"
              style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <p className="text-base font-semibold text-zinc-100">{a.name}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                    {TYPE_LABEL[a.type] ?? a.type}
                  </span>
                  {a.published && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-accent-emerald-bg text-accent-emerald">
                      live
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-zinc-400 mb-3">
                {a.steps.length ? `${a.steps.length}-step procedure · ${a.timeboxMinutes} min` : 'No fixed procedure'}
                {a.recordingsProcessing > 0
                  ? ' · learning…'
                  : a.hasPlaybook
                    ? ` · trained on ${a.recordingCount} source${a.recordingCount === 1 ? '' : 's'}`
                    : ' · not yet trained'}
              </p>
              <div className="flex items-center gap-2">
                <Link
                  href={`/dashboard/${workspaceId}/copilot/run?agent=${a.id}`}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold text-white"
                  style={{ background: 'var(--accent-primary)' }}
                >
                  Start session
                </Link>
                <Link
                  href={`/dashboard/${workspaceId}/copilot/agents/${a.id}`}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors"
                >
                  Edit / teach / deploy
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Built-in quick-starts — small, secondary; these are sessions for
          YOU (the operator), not buildable agents. */}
      <p className="text-xs text-zinc-500 mb-8">
        Need help yourself?{' '}
        <Link href={`/dashboard/${workspaceId}/copilot/run?mode=general`} className="underline hover:text-zinc-300">
          general support session
        </Link>{' '}
        ·{' '}
        <Link href={`/dashboard/${workspaceId}/copilot/run?mode=onboarding`} className="underline hover:text-zinc-300">
          guided workspace onboarding
        </Link>
      </p>

      <PastSessions workspaceId={workspaceId} refreshKey={0} />
    </div>
  )
}
