'use client'

import { useEffect, useState } from 'react'
import { useParams, usePathname } from 'next/navigation'
import Link from 'next/link'

const SECTIONS = [
  { key: 'settings',    label: 'Settings',    path: '' },
  { key: 'deploy',      label: 'Channels',    path: '/deploy' },
  { key: 'knowledge',   label: 'Knowledge',   path: '/knowledge' },
  { key: 'rules',       label: 'Rules',       path: '/rules' },
  { key: 'tools',       label: 'Tools',       path: '/tools' },
  { key: 'qualifying',  label: 'Qualifying',  path: '/qualifying' },
  { key: 'persona',     label: 'Persona',     path: '/persona' },
  { key: 'goals',       label: 'Goals',       path: '/goals' },
  { key: 'triggers',    label: 'Triggers',    path: '/triggers' },
  { key: 'follow-ups',  label: 'Follow-ups',  path: '/follow-ups' },
  { key: 'voice',       label: 'Voice',       path: '/voice' },
]

export default function AgentLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const pathname = usePathname()
  const locationId = params.locationId as string
  const agentId = params.agentId as string

  const base = `/dashboard/${locationId}/agents/${agentId}`

  const [agent, setAgent] = useState<{ name: string; isActive: boolean } | null>(null)
  const [toggling, setToggling] = useState(false)
  const [channelCount, setChannelCount] = useState<number | null>(null)

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => setAgent({ name: agent.name, isActive: agent.isActive }))
  }, [locationId, agentId])

  useEffect(() => {
    fetch(`/api/locations/${locationId}/agents/${agentId}/deploy`)
      .then(r => r.json())
      .then(({ deployments }) => {
        if (Array.isArray(deployments)) {
          const active = deployments.filter((d: { enabled?: boolean }) => d.enabled !== false)
          setChannelCount(active.length)
        }
      })
      .catch(() => {})
  }, [locationId, agentId])

  async function toggleActive() {
    if (!agent) return
    setToggling(true)
    const res = await fetch(`/api/locations/${locationId}/agents/${agentId}`, {
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

  return (
    <div className="flex flex-col h-full">
      {/* Agent header */}
      <div className="flex items-center justify-between px-8 pt-6 pb-0 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            href={`/dashboard/${locationId}/agents`}
            className="text-zinc-600 hover:text-zinc-400 transition-colors text-sm"
          >
            ← Agents
          </Link>
          <span className="text-zinc-700">/</span>
          {agent ? (
            <>
              <h1 className="text-lg font-semibold">{agent.name}</h1>
              <span
                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                  agent.isActive
                    ? 'bg-emerald-400/10 text-emerald-400 ring-1 ring-inset ring-emerald-400/30'
                    : 'bg-zinc-400/10 text-zinc-400 ring-1 ring-inset ring-zinc-400/30'
                }`}
              >
                {agent.isActive ? 'Live' : 'Inactive'}
              </span>
            </>
          ) : (
            <div className="h-5 w-32 bg-zinc-800 rounded animate-pulse" />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/${locationId}/playground?agentId=${agentId}`}
            className="text-xs text-zinc-400 hover:text-white border border-zinc-800 hover:border-zinc-600 rounded-lg px-3 py-1.5 transition-colors"
          >
            Test
          </Link>
          <button
            onClick={toggleActive}
            disabled={toggling || !agent}
            className={`text-xs border rounded-lg px-3 py-1.5 transition-colors disabled:opacity-50 ${
              agent?.isActive
                ? 'border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-600'
                : 'border-emerald-800 text-emerald-400 hover:border-emerald-600'
            }`}
          >
            {toggling ? '...' : agent?.isActive ? 'Deactivate' : 'Activate'}
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
