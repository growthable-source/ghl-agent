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
import { KpiTile, PageHeader, Pill, StatusBadge } from '@/components/ui/primitives'
import { buttonClass, cx, dataTable } from '@/lib/ui-classes'

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
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!workspaceId) return
    void fetch(`/api/workspaces/${workspaceId}/copilot/agents`)
      .then(r => (r.ok ? r.json() : { agents: [] }))
      .then(d => setAgents(Array.isArray(d.agents) ? d.agents : []))
      .catch(() => setAgents([]))
      .finally(() => setLoaded(true))
  }, [workspaceId])

  if (!workspaceId) return null

  const types = ['all', ...Array.from(new Set(agents.map(a => a.type)))]
  const rows = agents.filter(a =>
    (typeFilter === 'all' || a.type === typeFilter) &&
    (!query.trim() || a.name.toLowerCase().includes(query.trim().toLowerCase())))
  const live = agents.filter(a => a.published).length
  const untrained = agents.filter(a => !a.hasPlaybook && a.recordingsProcessing === 0).length
  const trainingLabel = (a: AgentRow) =>
    a.recordingsProcessing > 0 ? { tone: 'info' as const, text: 'Learning…' }
    : a.hasPlaybook ? { tone: 'success' as const, text: `${a.recordingCount} source${a.recordingCount === 1 ? '' : 's'}` }
    : { tone: 'warning' as const, text: 'Not trained' }
  const typeTone = (t: string) => (t === 'support' ? 'info' : t === 'onboarding' ? 'ai' : 'neutral') as 'info' | 'ai' | 'neutral'

  return (
    <div className="max-w-[1200px] mx-auto p-6 w-full space-y-4">
      <PageHeader
        title="Co-Pilot"
        subtitle="Live screen-share agents that guide users through real calls. Teach them from recordings and SOPs, deploy by link, button or JS snippet."
        actions={<Link href={`/dashboard/${workspaceId}/copilot/new`} className={buttonClass('primary')}>+ New Co-Pilot</Link>}
      />

      {/* TODO(redesign-followup): "Sessions · 7d" and "Avg. session" tiles and the per-agent sessions / last-session columns — the agents API returns no session aggregates (past sessions are listed below). */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile label="Co-Pilot agents" value={agents.length} suffix={`${live} live`} />
        <KpiTile label="Untrained agents" value={untrained} suffix={untrained > 0 ? 'teach from recordings' : undefined} deltaTone="warning" />
      </div>

      {loaded && agents.length === 0 ? (
        <div className="xv-card border-dashed p-10 text-center">
          <h2 className="text-[15px] font-semibold text-text-primary mb-1">No Co-Pilot agents yet</h2>
          <p className="text-[13px] text-text-tertiary mb-4 max-w-md mx-auto">
            Create your first one — pick a type (support, onboarding, or custom), give it directions and an SOP,
            and teach it from recordings of your best calls.
          </p>
          <Link href={`/dashboard/${workspaceId}/copilot/new`} className={buttonClass('primary')}>Create your first agent</Link>
        </div>
      ) : agents.length > 0 && (
        <div className="xv-card">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border-theme">
            <div className="inline-flex items-center rounded-md bg-surface-secondary p-0.5">
              {types.map(t => (
                <button key={t} type="button" aria-pressed={typeFilter === t} onClick={() => setTypeFilter(t)}
                  className={cx('h-7 px-2.5 rounded text-[12px] font-medium cursor-pointer',
                    typeFilter === t ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary')}>
                  {t === 'all' ? 'All' : TYPE_LABEL[t] ?? t}{' '}
                  <span className="text-text-muted tabular-nums">{t === 'all' ? agents.length : agents.filter(a => a.type === t).length}</span>
                </button>
              ))}
            </div>
            <div className="flex-1" />
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search Co-Pilots…" aria-label="Search Co-Pilots"
              className="h-8 w-[220px] rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] outline-none focus:border-brand-500" />
          </div>
          <table className={dataTable.table}>
            <thead className={dataTable.thead}>
              <tr>{['Agent', 'Type', 'Procedure', 'Training', 'Status', ''].map(h => <th key={h} className={dataTable.th}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map(a => {
                const tr = trainingLabel(a)
                return (
                  <tr key={a.id} className={dataTable.tr()}>
                    <td className={`${dataTable.td} font-medium`}>
                      <Link href={`/dashboard/${workspaceId}/copilot/agents/${a.id}`} className="hover:underline">{a.name}</Link>
                    </td>
                    <td className={dataTable.td}><Pill tone={typeTone(a.type)}>{TYPE_LABEL[a.type] ?? a.type}</Pill></td>
                    <td className={`${dataTable.td} text-text-secondary`}>
                      {a.steps.length ? `${a.steps.length}-step procedure · ${a.timeboxMinutes} min` : 'No fixed procedure'}
                    </td>
                    <td className={dataTable.td}><Pill tone={tr.tone}>{tr.text}</Pill></td>
                    <td className={dataTable.td}><StatusBadge status={a.published ? 'live' : 'draft'} /></td>
                    <td className={dataTable.td}>
                      <div className="flex items-center justify-end gap-2">
                        <Link href={`/dashboard/${workspaceId}/copilot/run?agent=${a.id}`} className={buttonClass('primary', 'sm')}>▷ Start session</Link>
                        <Link href={`/dashboard/${workspaceId}/copilot/agents/${a.id}`} className={buttonClass('secondary', 'sm')}>Teach / deploy</Link>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {rows.length === 0 && <p className="py-8 text-center text-[13px] text-text-tertiary">No Co-Pilots match.</p>}
        </div>
      )}

      {/* Built-in quick-starts — sessions for YOU (the operator), not buildable agents. */}
      <p className="text-[12.5px] text-text-tertiary">
        Need help yourself?{' '}
        <Link href={`/dashboard/${workspaceId}/copilot/run?mode=general`} className="text-brand-500 hover:underline">general support session</Link>{' '}
        ·{' '}
        <Link href={`/dashboard/${workspaceId}/copilot/run?mode=onboarding`} className="text-brand-500 hover:underline">guided workspace onboarding</Link>
      </p>

      <PastSessions workspaceId={workspaceId} refreshKey={0} />
    </div>
  )
}
