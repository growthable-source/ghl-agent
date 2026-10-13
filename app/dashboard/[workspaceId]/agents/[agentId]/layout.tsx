'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { AgentReferenceHealthBanner } from '@/components/dashboard/AgentReferenceHealthBanner'
import NewBadge from '@/components/NewBadge'
import { ViewModeToggle } from '@/components/dashboard/ViewModeToggle'
import PlaygroundPanel from '@/components/dashboard/PlaygroundPanel'
import { SplitDeployButton, StatusBadge, type StatusKind } from '@/components/ui/primitives'
import { initials, timeAgo } from '@/lib/agents-list'
import { buttonClass, cx } from '@/lib/ui-classes'

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
    //
    // Note: the Voice sub-tab here is for SIMPLE/ADVANCED agents that
    // bolt voice onto a primarily-text agent. VOICE-typed agents
    // redirect to /voice/[id]/* before this layout renders — see the
    // useEffect below — so we don't keep a parallel VOICE_HUBS array.
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
    // Skills splits into two complementary surfaces:
    //   • Reflexes — model-callable tools (read, reply, calendar)
    //   • Playbook — operator-authored "when X, do Y" deterministic rules
    // The reflex/playbook split is deliberate: read tools are benign and
    // the model needs them as primitives; CRM mutations should never
    // fire on the model's discretion.
    key: 'skills',
    label: 'Skills',
    tabs: [
      { key: 'skills',       label: 'Overview',     path: '/skills' },
      { key: 'tools',        label: 'Tools',        path: '/tools' },
      { key: 'playbook',     label: 'Playbook',     path: '/playbook' },
      { key: 'integrations', label: 'Integrations', path: '/integrations' },
      { key: 'follow-ups',   label: 'Follow-ups',   path: '/follow-ups' },
      { key: 'goals',        label: 'Stop conditions', path: '/goals' },
    ],
  },
  {
    // "When does this agent fire?" — collapsed in Phase 7 from five
    // tabs (Overview/Channels/Routing/Working hours/Proactive) down to
    // two. The new /trigger page edits channels + CRM events inline
    // and summarises routing rules; the routing page stays accessible
    // for the compound condition builder, but isn't a top-level tab.
    // /deploy and /triggers (plural) redirect to /trigger.
    key: 'trigger',
    label: 'When to run',
    tabs: [
      { key: 'overview',      label: 'Triggers',         path: '/trigger' },
      { key: 'routing',       label: 'Filter rules',     path: '/routing' },
      { key: 'working-hours', label: 'Working hours',    path: '/working-hours' },
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

// Resolve a URL suffix back to the hub + tab it belongs to. Anything we
// don't recognise falls through to the first tab of the first hub.
// The candidate list comes from whichever HUBS array is active for
// the agent's type (text vs voice).
function resolveActive(suffix: string, candidates: { hub: Hub; tab: Tab }[]): { hub: Hub; tab: Tab } {
  const trimmed = suffix === '/' ? '' : suffix
  // Exact match first (handles '' → settings, '/voice' → voice,
  // '/knowledge/overview' → knowledge-overview, etc.).
  const exact = candidates.find(({ tab }) => tab.path === trimmed)
  if (exact) return exact
  // Prefix match for nested routes (e.g. '/replay/abc' → replay). Pick
  // the LONGEST match so '/knowledge/overview/anything' resolves to the
  // overview tab, not the parent /knowledge editor.
  const prefixMatches = candidates
    .filter(({ tab }) => tab.path !== '' && trimmed.startsWith(tab.path + '/'))
    .sort((a, b) => b.tab.path.length - a.tab.path.length)
  if (prefixMatches.length > 0) return prefixMatches[0]
  // Bare prefix match (e.g. '/replay' itself, no trailing segment).
  const bare = candidates.find(({ tab }) => tab.path !== '' && trimmed === tab.path)
  if (bare) return bare
  return candidates[0]
}

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [agent, setAgent] = useState<{ name: string; updatedAt: string | null; isActive: boolean; ruleCount: number; viewMode: 'simple' | 'advanced'; agentType: string; agentKind: string } | null>(null)
  const [toggling, setToggling] = useState(false)
  const [channelCount, setChannelCount] = useState<number | null>(null)
  // Right-hand test panel (handoff TestPanel). Closed by default so dense
  // editors keep their width; the choice is remembered per browser.
  const [testOpen, setTestOpen] = useState(false)
  useEffect(() => {
    try { setTestOpen(localStorage.getItem('xv:agent-test-panel') === '1') } catch { /* private mode */ }
  }, [])
  function toggleTest() {
    setTestOpen(o => {
      try { localStorage.setItem('xv:agent-test-panel', o ? '0' : '1') } catch { /* private mode */ }
      return !o
    })
  }

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        const agentType = typeof agent.agentType === 'string' ? agent.agentType : 'SIMPLE'
        // Voice agents have their own dedicated URL space at /voice/[id].
        // If we landed here (old bookmark, stale link), redirect to the
        // matching sub-tab under /voice/ so the sidebar and breadcrumb
        // are correct. Mapping is mostly 1:1 except the bolt-on
        // /agents/[id]/voice page → /voice/[id]/configuration.
        if (agentType === 'VOICE') {
          const suffix = pathname.replace(base, '') || ''
          const voiceBase = `/dashboard/${workspaceId}/voice/${agentId}`
          const target =
            suffix === '' || suffix === '/' ? voiceBase
            : suffix === '/voice' ? `${voiceBase}/configuration`
            : suffix === '/trigger' ? `${voiceBase}/triggers`
            : suffix === '/knowledge' ? `${voiceBase}/knowledge`
            : suffix === '/skills' ? `${voiceBase}/skills`
            : suffix === '/identity' ? `${voiceBase}/identity`
            : suffix.startsWith('/calls') ? `${voiceBase}/calls`
            : voiceBase // unknown sub-tab → Overview
          router.replace(target)
          return
        }
        setAgent({
          name: agent.name,
          updatedAt: typeof agent.updatedAt === 'string' ? agent.updatedAt : null,
          isActive: agent.isActive,
          // Routing rules are required for the agent to actually pick up
          // an inbound (the webhook pre-filter checks for ≥1). Surface the
          // count here so the header banner can flag the misconfig the
          // same way the listening pill on the agents list does.
          ruleCount: agent.routingRules?.length ?? 0,
          // viewMode drives whether the tabbed IA or the canvas is the
          // primary surface. Default to 'simple' when the column is missing
          // or the value isn't one we recognise.
          viewMode: agent.viewMode === 'advanced' ? 'advanced' : 'simple',
          // agentType drives which HUBS layout we render. VOICE agents
          // get redirected above; this branch only sees SIMPLE / ADVANCED.
          agentType,
          // Procedural agents get an extra "Procedure" tab; reactive (default)
          // agents don't — there's no step list to author.
          agentKind: agent.agentKind === 'procedural' ? 'procedural' : 'reactive',
        })
      })
  }, [workspaceId, agentId, pathname, base, router])

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
  // Voice-typed agents redirect to /voice/[id]/* before this point, so
  // by the time the tab strip renders we only ever have a text agent.
  // Procedural agents get a "Procedure" tab inserted into the Skills hub
  // (right after its Overview); reactive agents never see it.
  const isProceduralAgent = agent?.agentKind === 'procedural'
  const activeHubs = isProceduralAgent
    ? HUBS.map(h => h.key === 'skills'
        ? { ...h, tabs: [h.tabs[0], { key: 'procedure', label: 'Procedure', path: '/procedure' }, ...h.tabs.slice(1)] }
        : h)
    : HUBS
  const candidates = activeHubs.flatMap(h => h.tabs.map(t => ({ hub: h, tab: t })))
  const { hub: activeHub, tab: activeTab } = resolveActive(suffix, candidates)

  // In advanced mode the canvas is the entire surface — the tabbed nav
  // strips below the header are hidden so the /flow page renders edge
  // to edge. The header itself (breadcrumb + status + Test/Pause + the
  // toggle pill) stays so operators have a way back out.
  const isAdvanced = agent?.viewMode === 'advanced'

  function tabLabel(tab: Tab) {
    if (tab.key === 'deploy' && channelCount !== null && channelCount > 0) {
      return `${tab.label} (${channelCount})`
    }
    return tab.label
  }

  // Status. Mirrors the listening pill on the agents list — same three
  // states, same logic, same words. Webhook pre-filter requires both
  // a channel deployment AND at least one routing rule, so both have
  // to be true before the banner reads "Live".
  //   Live    = active + at least one channel + at least one routing rule
  //   No rules = active + channels but no routing rules
  //   Idle    = active but zero channels
  //   Paused  = isActive=false
  const isActive = agent?.isActive ?? false
  const hasChannels = (channelCount ?? 0) > 0
  const hasRules = (agent?.ruleCount ?? 0) > 0
  const statusKey = !isActive ? 'paused' : !hasChannels ? 'idle' : !hasRules ? 'norules' : 'live'
  const statusConfig = {
    live:    { label: 'Live', color: 'emerald', tooltip: 'Agent is active, has channels deployed, and has routing rules — it will pick up matching inbounds.' },
    idle:    { label: 'Active · No channels', color: 'amber', tooltip: 'Agent is active but not deployed on any channel. Add one in Trigger → Channels.' },
    norules: { label: 'Active · No rules', color: 'amber', tooltip: 'Agent has channels but no routing rules. The webhook pre-filter will skip every inbound until at least one rule is added in Trigger → Routing.' },
    paused:  { label: 'Paused', color: 'zinc', tooltip: "Agent is paused — it won't respond to any inbounds until you activate it." },
  }[statusKey]

  const badgeKind: StatusKind = statusKey === 'live' ? 'live' : statusKey === 'paused' ? 'paused' : 'attention'

  return (
    <div className="flex flex-col h-full">
      {/* Agent header: avatar tile · name + status · meta  |  actions */}
      <div className="flex items-center justify-between gap-4 px-6 py-4 shrink-0 bg-surface border-b border-border-theme">
        <div className="flex items-center gap-3 min-w-0">
          {agent ? (
            <>
              <span className="h-11 w-11 shrink-0 rounded-lg bg-brand-500 text-on-brand text-[14px] font-semibold flex items-center justify-center">
                {initials(agent.name)}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h1 className="text-[20px] leading-tight font-semibold tracking-tight text-text-primary truncate">{agent.name}</h1>
                  <span title={statusConfig.tooltip} className="cursor-help">
                    <StatusBadge status={badgeKind} label={statusConfig.label} />
                  </span>
                  {/* TODO(redesign-followup): version + "draft changes" chip (v8 · draft changes) — agents have no draft/publish versioning yet. */}
                </div>
                <p className="mt-0.5 text-[12px] text-text-tertiary truncate">
                  {channelCount ?? '—'} channel{channelCount === 1 ? '' : 's'} · {agent.ruleCount} routing rule{agent.ruleCount === 1 ? '' : 's'}
                  {agent.updatedAt && <> · Edited {timeAgo(agent.updatedAt)}</>}
                </p>
              </div>
            </>
          ) : (
            <div className="h-11 w-56 rounded-lg animate-pulse bg-surface-tertiary" />
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {agent && <ViewModeToggle workspaceId={workspaceId} agentId={agentId} viewMode={agent.viewMode} />}
          <Link href={`${base}/prompt-versions`} className={buttonClass('secondary')}>History</Link>
          <button type="button" onClick={toggleTest} aria-pressed={testOpen} className={buttonClass('secondary', 'md', testOpen ? 'bg-surface-secondary' : undefined)}>
            ▷ Test
          </button>
          <SplitDeployButton
            label={agent?.isActive ? 'Pause' : 'Activate'}
            variant={agent?.isActive ? 'secondary' : 'primary'}
            busy={toggling}
            disabled={!agent}
            onClick={toggleActive}
            items={[
              { label: 'Deploy to channels…', hint: 'Channels and CRM events', href: `${base}/trigger` },
              // TODO(redesign-followup): scheduled deploys and saved drafts need versioning/scheduling support that doesn't exist yet.
              { label: 'Schedule…', hint: 'Coming soon', disabled: true },
              { label: 'Save draft', hint: 'Coming soon', disabled: true },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* Section rail — every hub and its pages, replacing the two
            horizontal tab strips. Hidden in advanced (canvas) mode. */}
        {!isAdvanced && (
          <nav aria-label="Agent sections" className="hidden lg:block w-[232px] shrink-0 border-r border-border-theme bg-surface overflow-y-auto px-3 py-4">
            {activeHubs.map(h => (
              <div key={h.key} className="mb-4">
                <p className={cx('px-2 pb-1 text-[12.5px] font-semibold', activeHub.key === h.key ? 'text-text-primary' : 'text-text-secondary')}>{h.label}</p>
                <div className="ml-2 border-l border-border-theme">
                  {h.tabs.map(t => {
                    const isActive = activeTab.key === t.key && activeHub.key === h.key
                    return (
                      <Link
                        key={t.key}
                        href={`${base}${t.path}`}
                        aria-current={isActive ? 'page' : undefined}
                        className={cx('flex items-center h-8 pl-3 pr-2 -ml-px border-l-2 text-[13px] transition-colors',
                          isActive
                            ? 'border-brand-500 bg-brand-50 text-brand-700 font-medium'
                            : 'border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-secondary')}
                      >
                        {tabLabel(t)}
                        {t.key === 'tools' && <NewBadge since="2026-05-29" className="ml-1.5" />}
                        {t.key === 'procedure' && <NewBadge since="2026-06-18" className="ml-1.5" />}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Narrow screens: the rail is hidden, so offer a section picker. */}
          {!isAdvanced && (
            <div className="lg:hidden px-4 pt-3 shrink-0">
              <select
                aria-label="Agent section"
                value={activeTab.path}
                onChange={e => router.push(`${base}${e.target.value}`)}
                className="w-full h-9 rounded-md border border-border-theme bg-surface px-2 text-[13px]"
              >
                {activeHubs.map(h => (
                  <optgroup key={h.key} label={h.label}>
                    {h.tabs.map(t => <option key={t.key} value={t.path}>{tabLabel(t)}</option>)}
                  </optgroup>
                ))}
              </select>
            </div>
          )}
          {/* Page content. In advanced mode the canvas is the entire surface
              so the reference-health banner and padding wrapper are suppressed
              — /flow sizes itself with viewport math and wants edge-to-edge. */}
          <div className="flex-1 overflow-y-auto">
            {!isAdvanced && (
              <div className="px-6 pt-4">
                <AgentReferenceHealthBanner workspaceId={workspaceId} agentId={agentId} />
              </div>
            )}
            {children}
          </div>
        </div>

        {testOpen && agent && (
          <aside aria-label="Test chat" className="hidden md:flex w-[360px] shrink-0 flex-col border-l border-border-theme bg-surface">
            <div className="h-11 px-4 flex items-center justify-between border-b border-border-theme shrink-0">
              <span className="text-[13px] font-semibold text-text-primary">Test chat</span>
              <button type="button" onClick={toggleTest} className="text-[12px] text-text-tertiary hover:text-text-primary cursor-pointer">Close</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {/* Reuses the Playground runtime (POST /playground) pinned to this agent. */}
              <PlaygroundPanel workspaceId={workspaceId} agents={[{ id: agentId, name: agent.name }]} defaultAgentId={agentId} />
            </div>
            {/* TODO(redesign-followup): "Simulating contact" picker, channel selector (SMS · draft vN) and latency/cost stats in the test panel. */}
          </aside>
        )}
      </div>
    </div>
  )
}
