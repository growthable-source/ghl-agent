'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'

type Section = { key: string; label: string; path: string }

// Surfaced as visible tabs — the things operators touch every day.
// Order matches the mental model from the IA mockup: who the agent is
// → what it knows → what it does → where it lives.
const PRIMARY_SECTIONS: Section[] = [
  { key: 'settings',    label: 'Identity',    path: '' },
  { key: 'knowledge',   label: 'Knowledge',   path: '/knowledge' },
  { key: 'tools',       label: 'Actions',     path: '/tools' },
  { key: 'rules',       label: 'Rules',       path: '/rules' },
  { key: 'deploy',      label: 'Channels',    path: '/deploy' },
]

// Tucked under "More" — kept fully reachable, demoted out of the
// horizontal strip so the primary surface stays scannable. Grouped by
// concept; the headings render as section labels inside the menu.
const MORE_GROUPS: { heading: string; items: Section[] }[] = [
  {
    heading: 'Identity',
    items: [
      { key: 'persona', label: 'Persona',  path: '/persona' },
      { key: 'voice',   label: 'Voice',    path: '/voice' },
    ],
  },
  {
    heading: 'Behaviour',
    items: [
      { key: 'triggers',   label: 'Triggers',   path: '/triggers' },
      { key: 'qualifying', label: 'Qualifying', path: '/qualifying' },
      { key: 'listening',  label: 'Listening',  path: '/listening' },
      { key: 'follow-ups', label: 'Follow-ups', path: '/follow-ups' },
    ],
  },
  {
    heading: 'Outcomes',
    items: [
      { key: 'wins',  label: 'Objectives',     path: '/wins' },
      { key: 'goals', label: 'Stop conditions', path: '/goals' },
    ],
  },
  {
    heading: 'Deploy',
    items: [
      { key: 'routing',      label: 'Routing',       path: '/routing' },
      { key: 'integrations', label: 'Integrations',  path: '/integrations' },
    ],
  },
  {
    heading: 'Optimise',
    items: [
      { key: 'replay',      label: 'Replay',      path: '/replay' },
      { key: 'experiments', label: 'Experiments', path: '/experiments' },
    ],
  },
]

const ALL_SECTIONS: Section[] = [
  ...PRIMARY_SECTIONS,
  ...MORE_GROUPS.flatMap(g => g.items),
]

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [agent, setAgent] = useState<{ name: string; isActive: boolean } | null>(null)
  const [toggling, setToggling] = useState(false)
  const [channelCount, setChannelCount] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => setAgent({ name: agent.name, isActive: agent.isActive }))
  }, [workspaceId, agentId])

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`)
      .then(r => r.json())
      .then(({ deployments }) => {
        if (Array.isArray(deployments)) {
          // Channels are keyed by `isActive`, not `enabled` — old code used
          // the wrong field and counted inactive deployments as live.
          const active = deployments.filter((d: { isActive?: boolean }) => d.isActive === true)
          setChannelCount(active.length)
        }
      })
      .catch(() => {})
  }, [workspaceId, agentId])

  async function toggleActive() {
    if (!agent) return
    setToggling(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !agent.isActive }),
    })
    const { agent: updated } = await res.json()
    setAgent(a => a ? { ...a, isActive: updated.isActive } : a)
    setToggling(false)
  }

  // Determine active section across the full universe of routes (not
  // just the visible primary tabs) so a "More" item highlights its
  // grouping correctly.
  const suffix = pathname.replace(base, '')
  const activeKey = ALL_SECTIONS.find(s => {
    if (s.path === '') return suffix === '' || suffix === '/'
    return suffix.startsWith(s.path)
  })?.key ?? 'settings'

  // True when the active route lives under the "More" disclosure — the
  // trigger button highlights to confirm the user it isn't lost.
  const moreItems = MORE_GROUPS.flatMap(g => g.items)
  const moreActive = moreItems.some(s => s.key === activeKey)

  function getTabLabel(section: Section) {
    if (section.key === 'deploy' && channelCount !== null && channelCount > 0) {
      return `${section.label} (${channelCount})`
    }
    return section.label
  }

  // Compute status:
  //   - Live: isActive=true AND at least one channel deployed
  //   - Active but idle: isActive=true but no channels deployed (agent won't receive anything)
  //   - Paused: isActive=false
  const isActive = agent?.isActive ?? false
  const hasChannels = (channelCount ?? 0) > 0
  const statusKey = !isActive ? 'paused' : !hasChannels ? 'idle' : 'live'
  const statusConfig = {
    live: { label: 'Live', color: 'emerald', tooltip: 'Agent is active and deployed on at least one channel.' },
    idle: { label: 'Active · No channels', color: 'amber', tooltip: 'Agent is active but not deployed on any channel. Add one in the Channels tab to start receiving messages.' },
    paused: { label: 'Paused', color: 'zinc', tooltip: 'Agent is paused — it won\'t respond to any inbounds until you activate it.' },
  }[statusKey]

  return (
    <div className="flex flex-col h-full">
      {/* Agent header */}
      <div className="flex items-center justify-between px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/${workspaceId}/agents`}
            className="transition-colors text-sm"
            style={{ color: 'var(--text-tertiary)' }}
          >
            ← Agents
          </Link>
          <span style={{ color: 'var(--text-muted)' }}>/</span>
          {agent ? (
            <>
              <h1 className="text-lg font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>{agent.name}</h1>
              <span
                title={statusConfig.tooltip}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium cursor-help"
                style={
                  statusConfig.color === 'emerald'
                    ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                    : statusConfig.color === 'amber'
                    ? { background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }
                    : { background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }
                }
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{
                    background: statusConfig.color === 'emerald'
                      ? 'var(--accent-emerald)'
                      : statusConfig.color === 'amber'
                      ? 'var(--accent-amber)'
                      : 'var(--text-tertiary)',
                  }}
                />
                {statusConfig.label}
              </span>
            </>
          ) : (
            <div className="h-5 w-32 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${workspaceId}/playground?agentId=${agentId}`}
            className="text-xs border rounded-lg px-3 py-1.5 transition-colors"
            style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
          >
            Test
          </Link>
          <button
            onClick={toggleActive}
            disabled={toggling || !agent}
            title={agent?.isActive ? 'Pause this agent — it will stop responding to inbounds' : 'Activate this agent so it starts responding to inbounds'}
            className="text-xs border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50"
            style={
              agent?.isActive
                ? { color: 'var(--text-secondary)', borderColor: 'var(--border)' }
                : { color: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }
            }
          >
            {toggling ? '...' : agent?.isActive ? 'Pause' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Section nav — primary tabs + "More" disclosure for the long
          tail. Kept the same routes; just trimmed what's visible at
          rest. */}
      <div
        className="flex gap-0 px-8 mt-4 border-b shrink-0 overflow-x-auto items-stretch"
        style={{ borderColor: 'var(--border)' }}
      >
        {PRIMARY_SECTIONS.map(s => {
          const isActive = activeKey === s.key
          return (
            <Link
              key={s.key}
              href={`${base}${s.path}`}
              className="px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors"
              style={
                isActive
                  ? { borderBottomColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }
                  : { borderBottomColor: 'transparent', color: 'var(--text-tertiary)' }
              }
            >
              {getTabLabel(s)}
            </Link>
          )
        })}

        {/* More disclosure — native <details> for free state without a
            new piece of useState. position: relative on parent so the
            popover anchors to the trigger. */}
        <details className="relative ml-1 flex items-stretch">
          <summary
            className="cursor-pointer list-none px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors flex items-center gap-1"
            style={
              moreActive
                ? { borderBottomColor: 'var(--accent-primary)', color: 'var(--accent-primary)' }
                : { borderBottomColor: 'transparent', color: 'var(--text-tertiary)' }
            }
          >
            More
            <svg className="w-3 h-3 opacity-70" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </summary>
          <div
            className="absolute right-0 top-full mt-1 z-30 w-64 rounded-lg border shadow-lg overflow-hidden"
            style={{ background: 'var(--surface)', borderColor: 'var(--border-secondary)' }}
          >
            {MORE_GROUPS.map(group => (
              <div key={group.heading} className="py-1">
                <p
                  className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider font-semibold"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {group.heading}
                </p>
                {group.items.map(item => {
                  const isActive = activeKey === item.key
                  return (
                    <Link
                      key={item.key}
                      href={`${base}${item.path}`}
                      className="block px-3 py-1.5 text-sm transition-colors"
                      style={
                        isActive
                          ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                          : { color: 'var(--text-secondary)' }
                      }
                    >
                      {getTabLabel(item)}
                    </Link>
                  )
                })}
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
