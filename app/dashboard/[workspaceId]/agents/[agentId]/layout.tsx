'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'

// ─── IA ──────────────────────────────────────────────────────────────────────
// Five primary "hubs" that answer the only five questions an operator has
// about an agent: who is it, what does it know, what can it do, when does
// it fire, and what's it been doing lately. Every legacy sub-page is
// reachable from one of these — old URLs still work, just framed under
// the hub their setting belongs to.

type Tab = { key: string; label: string; path: string }
type Hub = { key: string; label: string; tabs: Tab[] }

const HUBS: Hub[] = [
  {
    // Each hub's first tab is its Overview — a read-only summary of every
    // sub-page's current state. Operators land there when they click the
    // primary tab and drill into specific editors only when they need to
    // make a change. The overview pages live at /identity, /knowledge/overview,
    // /skills, /trigger, /activity respectively.
    key: 'identity',
    label: 'Identity',
    tabs: [
      { key: 'identity', label: 'Overview', path: '/identity' },
      { key: 'settings', label: 'Settings', path: '' },
      { key: 'persona',  label: 'Persona',  path: '/persona' },
      { key: 'voice',    label: 'Voice',    path: '/voice' },
    ],
  },
  {
    key: 'knowledge',
    label: 'Knowledge',
    tabs: [
      { key: 'knowledge-overview', label: 'Overview',   path: '/knowledge/overview' },
      { key: 'knowledge',          label: 'Entries',    path: '/knowledge' },
      { key: 'listening',          label: 'Listening',  path: '/listening' },
      { key: 'qualifying',         label: 'Qualifying', path: '/qualifying' },
    ],
  },
  {
    key: 'skills',
    label: 'Skills',
    tabs: [
      { key: 'skills',       label: 'Overview',         path: '/skills' },
      { key: 'tools',        label: 'Actions',          path: '/tools' },
      { key: 'integrations', label: 'Integrations',     path: '/integrations' },
      { key: 'follow-ups',   label: 'Follow-ups',       path: '/follow-ups' },
      { key: 'goals',        label: 'Stop conditions',  path: '/goals' },
    ],
  },
  {
    // The whole reason this refactor exists. Channels, Rules, Routing,
    // Working hours and Contact triggers all answer the same question
    // — "when does this agent fire?" — and were spread across five
    // separate top-level tabs. They live under Trigger now, with an
    // Overview landing page that summarises every system in one view.
    key: 'trigger',
    label: 'Trigger',
    tabs: [
      { key: 'overview',      label: 'Overview',         path: '/trigger' },
      { key: 'deploy',        label: 'Channels',         path: '/deploy' },
      { key: 'routing',       label: 'Routing',          path: '/routing' },
      { key: 'rules',         label: 'Detection rules',  path: '/rules' },
      { key: 'working-hours', label: 'Working hours',    path: '/working-hours' },
      { key: 'triggers',      label: 'Proactive',        path: '/triggers' },
    ],
  },
  {
    key: 'activity',
    label: 'Activity',
    tabs: [
      { key: 'activity',        label: 'Overview',       path: '/activity' },
      { key: 'replay',          label: 'Replay',         path: '/replay' },
      { key: 'wins',            label: 'Objectives',     path: '/wins' },
      { key: 'evaluations',     label: 'Evaluations',    path: '/evaluations' },
      { key: 'experiments',     label: 'Experiments',    path: '/experiments' },
      { key: 'prompt-versions', label: 'Prompt history', path: '/prompt-versions' },
    ],
  },
]

const ALL_TABS: { hub: Hub; tab: Tab }[] = HUBS.flatMap(h =>
  h.tabs.map(t => ({ hub: h, tab: t })),
)

// Resolve a URL suffix back to the hub + tab it belongs to. Anything we
// don't recognise falls through to Identity / Overview.
function resolveActive(suffix: string): { hub: Hub; tab: Tab } {
  const trimmed = suffix === '/' ? '' : suffix
  // Exact match first (handles '' → settings, '/voice' → voice,
  // '/knowledge/overview' → knowledge-overview, etc.).
  const exact = ALL_TABS.find(({ tab }) => tab.path === trimmed)
  if (exact) return exact
  // Prefix match for nested routes (e.g. '/replay/abc' → replay). Pick
  // the LONGEST match so '/knowledge/overview/anything' resolves to the
  // overview tab, not the parent /knowledge editor.
  const prefixMatches = ALL_TABS
    .filter(({ tab }) => tab.path !== '' && trimmed.startsWith(tab.path + '/'))
    .sort((a, b) => b.tab.path.length - a.tab.path.length)
  if (prefixMatches.length > 0) return prefixMatches[0]
  // Bare prefix match (e.g. '/replay' itself, no trailing segment).
  const bare = ALL_TABS.find(({ tab }) => tab.path !== '' && trimmed === tab.path)
  if (bare) return bare
  return ALL_TABS[0]
}

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

  const suffix = pathname.replace(base, '')
  const { hub: activeHub, tab: activeTab } = resolveActive(suffix)

  function tabLabel(tab: Tab) {
    if (tab.key === 'deploy' && channelCount !== null && channelCount > 0) {
      return `${tab.label} (${channelCount})`
    }
    return tab.label
  }

  // Status:
  //   Live   = active + at least one channel deployed
  //   Idle   = active but zero channels (no inbound will land)
  //   Paused = isActive=false
  const isActive = agent?.isActive ?? false
  const hasChannels = (channelCount ?? 0) > 0
  const statusKey = !isActive ? 'paused' : !hasChannels ? 'idle' : 'live'
  const statusConfig = {
    live:   { label: 'Live', color: 'emerald', tooltip: 'Agent is active and deployed on at least one channel.' },
    idle:   { label: 'Active · No channels', color: 'amber', tooltip: 'Agent is active but not deployed on any channel. Add one in Trigger → Channels.' },
    paused: { label: 'Paused', color: 'zinc', tooltip: "Agent is paused — it won't respond to any inbounds until you activate it." },
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

      {/* Primary tabs — five hubs. Renders without a bottom border when
          a secondary strip follows it, so the two strips read as one
          continuous nav rather than stacked banners. */}
      <div className="flex items-stretch px-8 mt-4 shrink-0">
        <div className="flex items-stretch gap-1 overflow-x-auto min-w-0 flex-1">
          {HUBS.map(h => {
            const isActive = activeHub.key === h.key
            const href = `${base}${h.tabs[0].path}`
            return (
              <Link
                key={h.key}
                href={href}
                className="px-3 py-2 text-[13px] font-medium tracking-tight whitespace-nowrap rounded-md transition-colors"
                style={
                  isActive
                    ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }
                    : { color: 'var(--text-secondary)' }
                }
                onMouseEnter={e => {
                  if (!isActive) e.currentTarget.style.color = 'var(--text-primary)'
                }}
                onMouseLeave={e => {
                  if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'
                }}
              >
                {h.label}
              </Link>
            )
          })}
        </div>
      </div>

      {/* Divider that sits between primary and secondary strips. Single
          line, full bleed under the page padding. */}
      <div className="px-8 mt-2 shrink-0">
        <div className="h-px" style={{ background: 'var(--border)' }} />
      </div>

      {/* Secondary tabs — sections within the active hub. Underline-style
          on the same canvas (no banner background), smaller text and
          tighter padding so the hierarchy is obvious without shouting. */}
      {activeHub.tabs.length > 1 && (
        <div className="flex items-stretch px-8 shrink-0">
          <div className="flex items-stretch gap-0 overflow-x-auto min-w-0 flex-1">
            {activeHub.tabs.map(t => {
              const isActive = activeTab.key === t.key
              return (
                <Link
                  key={t.key}
                  href={`${base}${t.path}`}
                  className="relative px-3 py-2.5 text-xs font-medium whitespace-nowrap transition-colors"
                  style={
                    isActive
                      ? { color: 'var(--accent-primary)' }
                      : { color: 'var(--text-tertiary)' }
                  }
                  onMouseEnter={e => {
                    if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)'
                  }}
                  onMouseLeave={e => {
                    if (!isActive) e.currentTarget.style.color = 'var(--text-tertiary)'
                  }}
                >
                  {tabLabel(t)}
                  {isActive && (
                    <span
                      className="absolute left-2 right-2 -bottom-px h-0.5 rounded-full"
                      style={{ background: 'var(--accent-primary)' }}
                    />
                  )}
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Bottom divider — separates the nav from page content. Always
          present so the canvas reads consistently whether or not a
          secondary strip is showing. */}
      <div className="shrink-0">
        <div className="h-px" style={{ background: 'var(--border)' }} />
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
