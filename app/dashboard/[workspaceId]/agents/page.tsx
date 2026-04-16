'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentData {
  id: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  enabledTools: string[]
  languages: string[]
  channelDeployments: { channel: string }[]
  vapiConfig: { isActive: boolean; phoneNumber: string | null } | null
  _count: {
    knowledgeEntries: number
    routingRules: number
    messageLogs: number
    conversationStates: number
  }
}

interface AgentsMeta {
  total: number
  limit: number | null
  plan: string
}

// ─── Channel badge colors ───────────────────────────────────────────────────

const CHANNEL_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  SMS:       { label: 'SMS',       color: '#22d3ee', bg: 'rgba(34,211,238,0.12)' },
  WhatsApp:  { label: 'WhatsApp',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  Email:     { label: 'Email',     color: '#a78bfa', bg: 'rgba(167,139,250,0.12)' },
  FB:        { label: 'Facebook',  color: '#60a5fa', bg: 'rgba(96,165,250,0.12)' },
  IG:        { label: 'Instagram', color: '#f472b6', bg: 'rgba(244,114,182,0.12)' },
  GMB:       { label: 'Google',    color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  Live_Chat: { label: 'Live Chat', color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [agents, setAgents] = useState<AgentData[]>([])
  const [meta, setMeta] = useState<AgentsMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`)
      const data = await res.json()
      setAgents(data.agents || [])
      setMeta(data.meta || null)
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  // Toggle agent active state
  async function toggleActive(agentId: string, currentlyActive: boolean) {
    setTogglingId(agentId)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !currentlyActive }),
      })
      if (res.ok) {
        setAgents(prev => prev.map(a =>
          a.id === agentId ? { ...a, isActive: !currentlyActive } : a
        ))
      }
    } catch (err) {
      console.error('Failed to toggle agent:', err)
    } finally {
      setTogglingId(null)
    }
  }

  // Delete agent
  async function deleteAgent(agentId: string) {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setAgents(prev => prev.filter(a => a.id !== agentId))
        setDeleteConfirm(null)
      }
    } catch (err) {
      console.error('Failed to delete agent:', err)
    }
  }

  // ─── Plan usage bar ────────────────────────────────────────────────────────

  const usedCount = meta?.total ?? agents.length
  const limitCount = meta?.limit
  const usagePercent = limitCount ? Math.min((usedCount / limitCount) * 100, 100) : 0
  const atLimit = limitCount ? usedCount >= limitCount : false

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
            <div className="h-10 w-32 bg-zinc-800 rounded-lg animate-pulse" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-52 bg-zinc-900/60 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">

        {/* ─── Header ──────────────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">Agents</h1>
            <p className="text-sm text-zinc-400 mt-1">Manage your AI agents, channels, and deployments</p>
          </div>

          <Link
            href={`/dashboard/${workspaceId}/agents/new`}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              atLimit
                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed pointer-events-none'
                : 'text-white hover:opacity-90'
            }`}
            style={!atLimit ? { background: '#fa4d2e' } : undefined}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            New Agent
          </Link>
        </div>

        {/* ─── Plan Usage Indicator ────────────────────────────────────── */}
        {limitCount !== null && limitCount !== undefined && (
          <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-300">
                  {usedCount} / {limitCount} agents used
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium"
                  style={{
                    background: 'rgba(250,77,46,0.12)',
                    color: '#fa4d2e',
                  }}
                >
                  {meta?.plan?.charAt(0).toUpperCase()}{meta?.plan?.slice(1)} plan
                </span>
              </div>
              {atLimit && (
                <Link
                  href={`/dashboard/${workspaceId}/settings/billing`}
                  className="text-xs font-medium hover:underline"
                  style={{ color: '#fa4d2e' }}
                >
                  Upgrade or add agent slots
                </Link>
              )}
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${usagePercent}%`,
                  background: atLimit
                    ? 'linear-gradient(90deg, #ef4444, #dc2626)'
                    : 'linear-gradient(90deg, #fa4d2e, #f97316)',
                }}
              />
            </div>
          </div>
        )}

        {/* ─── Empty State ─────────────────────────────────────────────── */}
        {agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 px-6 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-16 h-16 mb-4 rounded-full bg-zinc-800 flex items-center justify-center">
              <svg className="w-8 h-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">No agents yet</h3>
            <p className="text-sm text-zinc-400 text-center max-w-sm mb-6">
              Create your first AI agent to start automating conversations across SMS, WhatsApp, Email, and more.
            </p>
            <Link
              href={`/dashboard/${workspaceId}/agents/new`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create Agent
            </Link>
          </div>
        ) : (
          /* ─── Agent Grid ─────────────────────────────────────────────── */
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map(agent => (
              <div
                key={agent.id}
                className="group relative border border-zinc-800 rounded-xl bg-zinc-900/40 hover:border-zinc-700 transition-all duration-200 overflow-hidden"
              >
                {/* Status indicator bar */}
                <div
                  className="absolute top-0 left-0 right-0 h-0.5"
                  style={{
                    background: agent.isActive
                      ? 'linear-gradient(90deg, #22c55e, #16a34a)'
                      : 'linear-gradient(90deg, #52525b, #3f3f46)',
                  }}
                />

                <div className="p-5">
                  {/* Header: name + status toggle */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0 mr-3">
                      <Link
                        href={`/dashboard/${workspaceId}/agents/${agent.id}`}
                        className="text-base font-semibold text-white hover:underline truncate block"
                      >
                        {agent.name}
                      </Link>
                      <span className="text-xs text-zinc-500">
                        Created {timeAgo(agent.createdAt)}
                      </span>
                    </div>

                    {/* Active toggle */}
                    <button
                      onClick={() => toggleActive(agent.id, agent.isActive)}
                      disabled={togglingId === agent.id}
                      className="shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                      style={{
                        background: agent.isActive ? '#22c55e' : '#3f3f46',
                        opacity: togglingId === agent.id ? 0.5 : 1,
                      }}
                      title={agent.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                    >
                      <span
                        className="inline-block h-4 w-4 rounded-full bg-white transition-transform duration-200"
                        style={{
                          transform: agent.isActive ? 'translateX(22px)' : 'translateX(4px)',
                        }}
                      />
                    </button>
                  </div>

                  {/* Channel badges */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {agent.channelDeployments.length > 0 ? (
                      agent.channelDeployments.map((cd: { channel: string }) => {
                        const cfg = CHANNEL_CONFIG[cd.channel]
                        return cfg ? (
                          <span
                            key={cd.channel}
                            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: cfg.bg, color: cfg.color }}
                          >
                            {cfg.label}
                          </span>
                        ) : null
                      })
                    ) : (
                      <span className="text-[11px] text-zinc-600 italic">No channels deployed</span>
                    )}
                    {agent.vapiConfig?.isActive && (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                      >
                        Voice
                      </span>
                    )}
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-t border-zinc-800">
                    <div>
                      <p className="text-lg font-bold text-white">{agent._count.messageLogs.toLocaleString()}</p>
                      <p className="text-[11px] text-zinc-500">Messages</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{agent._count.conversationStates}</p>
                      <p className="text-[11px] text-zinc-500">Conversations</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-white">{agent._count.knowledgeEntries}</p>
                      <p className="text-[11px] text-zinc-500">Knowledge</p>
                    </div>
                  </div>

                  {/* Tools & rules summary */}
                  <div className="flex items-center gap-3 pt-3 border-t border-zinc-800 text-[11px] text-zinc-500">
                    <span>{agent.enabledTools?.length || 0} tools</span>
                    <span className="w-px h-3 bg-zinc-700" />
                    <span>{agent._count.routingRules} rules</span>
                    <span className="w-px h-3 bg-zinc-700" />
                    <span>{agent.languages?.join(', ') || 'en'}</span>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-4 pt-3 border-t border-zinc-800">
                    <Link
                      href={`/dashboard/${workspaceId}/agents/${agent.id}`}
                      className="flex-1 text-center text-xs font-medium py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                    >
                      Edit
                    </Link>
                    <Link
                      href={`/dashboard/${workspaceId}/agents/${agent.id}/deploy`}
                      className="flex-1 text-center text-xs font-medium py-2 rounded-lg text-white transition-colors hover:opacity-90"
                      style={{ background: 'rgba(250,77,46,0.8)' }}
                    >
                      Deploy
                    </Link>

                    {/* Delete button */}
                    {deleteConfirm === agent.id ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => deleteAgent(agent.id)}
                          className="text-xs font-medium py-2 px-3 rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs font-medium py-2 px-2 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(agent.id)}
                        className="p-2 rounded-lg text-zinc-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Delete agent"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
