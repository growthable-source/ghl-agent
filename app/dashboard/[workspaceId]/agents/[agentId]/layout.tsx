'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'

const SECTIONS = [
  { key: 'settings',    label: 'Settings',    path: '' },
  { key: 'deploy',      label: 'Channels',    path: '/deploy' },
  { key: 'knowledge',   label: 'Knowledge',   path: '/knowledge' },
  { key: 'routing',     label: 'Routing',     path: '/routing' },
  { key: 'rules',       label: 'Rules',       path: '/rules' },
  { key: 'listening',   label: 'Listening',   path: '/listening' },
  { key: 'tools',       label: 'Tools',       path: '/tools' },
  { key: 'qualifying',  label: 'Qualifying',  path: '/qualifying' },
  { key: 'persona',     label: 'Persona',     path: '/persona' },
  { key: 'wins',        label: 'Objectives',  path: '/wins' },
  { key: 'goals',       label: 'Stop Conds.', path: '/goals' },
  { key: 'triggers',    label: 'Triggers',    path: '/triggers' },
  { key: 'follow-ups',  label: 'Follow-ups',  path: '/follow-ups' },
  { key: 'voice',       label: 'Voice',       path: '/voice' },
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

  // Determine active section
  const suffix = pathname.replace(base, '')
  const activeKey = SECTIONS.find(s => {
    if (s.path === '') return suffix === '' || suffix === '/'
    return suffix.startsWith(s.path)
  })?.key ?? 'settings'

  function getTabLabel(section: typeof SECTIONS[number]) {
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
            className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm"
          >
            ← Agents
          </Link>
          <span className="text-zinc-700">/</span>
          {agent ? (
            <>
              <h1 className="text-lg font-semibold">{agent.name}</h1>
              <span
                title={statusConfig.tooltip}
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium cursor-help ${
                  statusConfig.color === 'emerald'
                    ? 'bg-emerald-400/10 text-emerald-400 ring-1 ring-inset ring-emerald-400/30'
                    : statusConfig.color === 'amber'
                    ? 'bg-amber-400/10 text-amber-400 ring-1 ring-inset ring-amber-400/30'
                    : 'bg-zinc-400/10 text-zinc-400 ring-1 ring-inset ring-zinc-400/30'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${
                  statusConfig.color === 'emerald' ? 'bg-emerald-400'
                  : statusConfig.color === 'amber' ? 'bg-amber-400'
                  : 'bg-zinc-400'
                }`} />
                {statusConfig.label}
              </span>
            </>
          ) : (
            <div className="h-5 w-32 bg-zinc-800 rounded animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${workspaceId}/playground?agentId=${agentId}`}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 rounded-lg px-3 py-1.5 transition-colors"
          >
            Test
          </Link>
          <button
            onClick={toggleActive}
            disabled={toggling || !agent}
            title={agent?.isActive ? 'Pause this agent — it will stop responding to inbounds' : 'Activate this agent so it starts responding to inbounds'}
            className={`text-xs border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 ${
              agent?.isActive
                ? 'border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'
                : 'border-emerald-800 text-emerald-400 hover:border-emerald-600'
            }`}
          >
            {toggling ? '...' : agent?.isActive ? 'Pause' : 'Activate'}
          </button>
        </div>
      </div>

      {/* Section nav */}
      <div className="flex gap-0 px-8 mt-4 border-b border-zinc-800 shrink-0 overflow-x-auto">
        {SECTIONS.map(s => (
          <Link
            key={s.key}
            href={`${base}${s.path}`}
            className={`px-3.5 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
              activeKey === s.key
                ? 'border-white text-white'
                : 'border-transparent text-zinc-500 hover:text-zinc-300'
            }`}
          >
            {getTabLabel(s)}
          </Link>
        ))}
      </div>

      {/* Page content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}
