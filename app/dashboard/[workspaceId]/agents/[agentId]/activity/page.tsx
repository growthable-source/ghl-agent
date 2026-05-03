'use client'

/**
 * Activity Overview — landing for the Activity hub.
 *
 * One-glance view of how the agent has actually been performing:
 *   • Recent runs        — counts + success rate from the last 7/30 days
 *   • Latest run         — last inbound the agent saw, with status
 *   • Replays / Evals    — the optimisation surfaces under the hub
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint } from '@/components/dashboard/AgentOverview'

interface Stats {
  counts: { day: number; week: number; month: number }
  successRate: number | null
  errors7d: number
  success7d: number
  total7d: number
  latest: { at: string; status: string; preview: string } | null
}

interface ListItem { id: string }

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

const STATUS_LABEL: Record<string, string> = {
  SUCCESS: 'Success',
  ERROR: 'Error',
  SKIPPED: 'Skipped',
  PENDING: 'Pending',
}

export default function ActivityOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [stats, setStats] = useState<Stats | null>(null)
  const [replays, setReplays] = useState<ListItem[] | null>(null)
  const [evaluations, setEvaluations] = useState<ListItem[] | null>(null)
  const [experiments, setExperiments] = useState<ListItem[] | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stats`)
        .then(r => r.json())
        .then(d => setStats(d))
        .catch(() => setStats({
          counts: { day: 0, week: 0, month: 0 },
          successRate: null, errors7d: 0, success7d: 0, total7d: 0, latest: null,
        })),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/replay`)
        .then(r => r.json())
        .then(d => setReplays(d.replays ?? d.items ?? []))
        .catch(() => setReplays([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/evaluations`)
        .then(r => r.json())
        .then(d => setEvaluations(d.evaluations ?? []))
        .catch(() => setEvaluations([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/experiments`)
        .then(r => r.json())
        .then(d => setExperiments(d.experiments ?? []))
        .catch(() => setExperiments([])),
    ])
  }, [workspaceId, agentId])

  if (stats === null || replays === null || evaluations === null || experiments === null) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-28 rounded-xl animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  // Headline pill colour reflects the success rate over the last week —
  // green if ≥95%, amber if 85–94%, red if below 85%, idle if no attempts.
  const ratePill: { tone: 'live' | 'warn' | 'idle'; label: string } =
    stats.successRate === null
      ? { tone: 'idle', label: 'No runs' }
      : stats.successRate >= 95
      ? { tone: 'live', label: `${stats.successRate}% success` }
      : stats.successRate >= 85
      ? { tone: 'warn', label: `${stats.successRate}% success` }
      : { tone: 'warn', label: `${stats.successRate}% success` }

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Recent runs */}
      <OverviewSection
        title="Recent runs"
        subtitle="How busy this agent has been and how often it succeeded. Errors here mean the agent attempted to reply and failed."
        pill={ratePill}
        editHref={`/dashboard/${workspaceId}/logs?agentId=${agentId}`}
        editLabel="Open logs"
      >
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {stats.counts.day.toLocaleString()}
            </p>
            <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Last 24h
            </p>
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {stats.counts.week.toLocaleString()}
            </p>
            <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Last 7 days
            </p>
          </div>
          <div>
            <p className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              {stats.counts.month.toLocaleString()}
            </p>
            <p className="text-[11px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Last 30 days
            </p>
          </div>
        </div>
        {stats.errors7d > 0 && (
          <p className="text-xs mt-2" style={{ color: 'var(--accent-amber)' }}>
            {stats.errors7d} {stats.errors7d === 1 ? 'error' : 'errors'} this week — open the logs to investigate.
          </p>
        )}
        {stats.latest && (
          <div
            className="mt-4 pt-3 border-t text-xs"
            style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}
          >
            Latest: <span style={{ color: 'var(--text-secondary)' }}>{STATUS_LABEL[stats.latest.status] ?? stats.latest.status}</span>
            {' · '}
            <span style={{ color: 'var(--text-secondary)' }}>{timeAgo(stats.latest.at)}</span>
            {stats.latest.preview && (
              <>
                {' · '}
                <span className="italic">"{stats.latest.preview}"</span>
              </>
            )}
          </div>
        )}
      </OverviewSection>

      {/* Replay */}
      <OverviewSection
        title="Replay"
        subtitle="Re-run past conversations against an updated prompt or knowledge to see what would have changed."
        pill={
          replays.length > 0
            ? { tone: 'info', label: `${replays.length} saved` }
            : { tone: 'idle', label: 'None yet' }
        }
        editHref={`${base}/replay`}
        editLabel="Open replay"
      >
        {replays.length === 0 ? (
          <EmptyHint>No replay sessions saved yet. Replay is the fastest way to test prompt changes against real past conversations.</EmptyHint>
        ) : (
          <OverviewRow label="Saved replay sessions" value={replays.length.toLocaleString()} />
        )}
      </OverviewSection>

      {/* Evaluations */}
      <OverviewSection
        title="Evaluations"
        subtitle="Test cases you can run against the agent's prompt to catch regressions before they ship."
        pill={
          evaluations.length > 0
            ? { tone: 'info', label: `${evaluations.length} ${evaluations.length === 1 ? 'test' : 'tests'}` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/evaluations`}
      >
        {evaluations.length === 0 ? (
          <EmptyHint>No evaluations defined yet. Add a few cases so prompt edits get caught before they ship.</EmptyHint>
        ) : (
          <OverviewRow label="Active test cases" value={evaluations.length.toLocaleString()} />
        )}
      </OverviewSection>

      {/* Experiments */}
      <OverviewSection
        title="Experiments"
        subtitle="A/B tests on the agent's behaviour — swap a prompt block, see which variant wins on real traffic."
        pill={
          experiments.length > 0
            ? { tone: 'info', label: `${experiments.length} running` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/experiments`}
      >
        {experiments.length === 0 ? (
          <EmptyHint>No experiments running. Add one when you want to A/B a prompt change.</EmptyHint>
        ) : (
          <OverviewRow label="Active experiments" value={experiments.length.toLocaleString()} />
        )}
      </OverviewSection>
    </div>
  )
}
