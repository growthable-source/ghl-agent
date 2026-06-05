'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import NewBadge from '@/components/NewBadge'
import { getLocationDashboardUrl } from '@/lib/leadconnector-dashboard-url'

// ─── Types ──────────────────────────────────────────────────────────────────

interface AgentData {
  id: string
  name: string
  isActive: boolean
  /** Optional folder grouping — null when the agent is unfiled. */
  folderId: string | null
  /**
   * Agent type — 'SIMPLE' | 'ADVANCED' | 'VOICE'. The card adds a 🎤
   * affordance on VOICE-typed agents and adjusts the channel pill row.
   */
  agentType?: string
  createdAt: string
  updatedAt: string
  enabledTools: string[]
  languages: string[]
  channelDeployments: { channel: string }[]
  vapiConfig: { isActive: boolean; phoneNumber: string | null } | null
  nextActions: { count: number; nextAt: string | null }
  /**
   * Which CRM sub-account this agent is wired to. The card uses
   * `businessName` to render "Connected to <Acme Co>" so operators can
   * spot at a glance which Location an agent runs on without opening
   * its settings. `provider` distinguishes native/none from real CRM
   * installs so the card can render a friendly label for those too.
   */
  connection?: {
    locationId: string
    businessName: string | null
    provider: string
  } | null
  _count: {
    knowledgeEntries?: number         // legacy: pre-knowledge-workspace servers
    attachedKnowledge?: number        // legacy: per-entry junction (now removed)
    attachedCollections?: number      // current: collection-count
    routingRules: number
    messageLogs: number
    conversationStates: number
  }
}

interface AgentFolderData {
  id: string
  name: string
  color: string | null
  order: number
}

// Sentinel "folder id" used by the filter pill bar to mean "agents that
// have no folder assigned". Real folder IDs are cuids and never collide
// with this string.
const UNFILED = '__unfiled__'

function formatNextActionTime(iso: string | null): string | null {
  if (!iso) return null
  const delta = new Date(iso).getTime() - Date.now()
  if (delta < 0) return 'now'
  const mins = Math.round(delta / 60000)
  if (mins < 60) return `in ${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `in ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 14) return `in ${days}d`
  return `in ${Math.round(days / 7)}w`
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

// ─── Listening status ───────────────────────────────────────────────────────
// Three-state pill that tells operators at a glance whether an agent will
// actually pick up an inbound. Derived from the same conditions the webhook
// pre-filter uses, so what you see here matches what would happen if a real
// SMS arrived right now.

type ListeningState = 'live' | 'misconfigured' | 'off'

function getListeningState(agent: AgentData): {
  state: ListeningState
  label: string
  reason: string
  fixHref: string | null
} {
  if (!agent.isActive) {
    return {
      state: 'off',
      label: 'Off',
      reason: 'Agent is turned off — flip the toggle to activate.',
      fixHref: null,
    }
  }
  const hasRules = (agent._count?.routingRules ?? 0) > 0
  const hasChannels = (agent.channelDeployments?.length ?? 0) > 0
  if (!hasRules || !hasChannels) {
    const missing: string[] = []
    if (!hasChannels) missing.push('channel deployment')
    if (!hasRules) missing.push('routing rule')
    return {
      state: 'misconfigured',
      label: 'Not deployed',
      reason: `Active but missing ${missing.join(' + ')} — inbounds will be skipped.`,
      fixHref: 'routing',
    }
  }
  return {
    state: 'live',
    label: 'Listening',
    reason: 'Active and listening on at least one channel.',
    fixHref: null,
  }
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
  // Duplicate / Save-as-template action tracking
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionFlash, setActionFlash] = useState<{ agentId: string; kind: 'ok' | 'err'; msg: string } | null>(null)

  // ─── Folders ──────────────────────────────────────────────────────────
  // A workspace's agents grow past the point where a flat grid scales
  // (sales / support / per-client whitelabel buckets). Folders are the
  // operator's organizing tool. Selecting a pill filters the grid;
  // selecting "All" (null) shows everything regardless of folder.
  const [folders, setFolders] = useState<AgentFolderData[]>([])
  const [foldersAvailable, setFoldersAvailable] = useState(true) // false if schema not yet migrated
  const [activeFolder, setActiveFolder] = useState<string | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null)
  const [editingFolderName, setEditingFolderName] = useState('')
  // When the per-agent menu opens the "Move to…" submenu we stash the
  // agentId here so the submenu knows which agent to PATCH.
  const [moveMenuAgentId, setMoveMenuAgentId] = useState<string | null>(null)

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`)
      const data = await res.json()
      // Voice agents live under their own /voice section as of 2026-06-06.
      // This page is the TEXT-agent surface — filter VOICE out so the
      // grid stays focused on SIMPLE/ADVANCED agents only.
      const textOnly = (data.agents || []).filter((a: AgentData) => a.agentType !== 'VOICE')
      setAgents(textOnly)
      setMeta(data.meta || null)
    } catch (err) {
      console.error('Failed to fetch agents:', err)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  const fetchFolders = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent-folders`)
      const data = await res.json()
      setFolders(data.folders || [])
      // notMigrated=true means the AgentFolder table doesn't exist yet
      // (fresh tenant on a build that ran before the migration). Hide
      // the folders UI entirely rather than letting every action fail.
      if (data.notMigrated) setFoldersAvailable(false)
    } catch (err) {
      console.error('Failed to fetch agent folders:', err)
      // Network failure — don't hide the UI; user can retry.
    }
  }, [workspaceId])

  useEffect(() => {
    fetchAgents()
    fetchFolders()
  }, [fetchAgents, fetchFolders])

  // ─── Folder CRUD + agent-move ─────────────────────────────────────────

  async function createFolder() {
    const name = newFolderName.trim()
    if (!name) { setNewFolderOpen(false); return }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent-folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, order: folders.length }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Create failed (${res.status})`)
      setFolders(prev => [...prev, data.folder])
      setNewFolderName('')
      setNewFolderOpen(false)
    } catch (err: any) {
      console.error('createFolder:', err)
    }
  }

  async function renameFolder(folderId: string) {
    const name = editingFolderName.trim()
    if (!name) { setEditingFolderId(null); return }
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent-folders/${folderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Rename failed (${res.status})`)
      setFolders(prev => prev.map(f => (f.id === folderId ? data.folder : f)))
    } catch (err: any) {
      console.error('renameFolder:', err)
    } finally {
      setEditingFolderId(null)
    }
  }

  async function deleteFolder(folderId: string) {
    // No confirm modal — folder delete is non-destructive (agents survive,
    // they just drop back to "Unfiled"). Matches WidgetFolder semantics.
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent-folders/${folderId}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Delete failed (${res.status})`)
      }
      setFolders(prev => prev.filter(f => f.id !== folderId))
      // Local-only fix-up: any agent whose folderId pointed at the
      // deleted folder is now unfiled. The DB SetNull does this server-
      // side too, but updating local state avoids a refetch.
      setAgents(prev => prev.map(a => (a.folderId === folderId ? { ...a, folderId: null } : a)))
      if (activeFolder === folderId) setActiveFolder(null)
    } catch (err: any) {
      console.error('deleteFolder:', err)
    }
  }

  async function moveAgentToFolder(agentId: string, folderId: string | null) {
    setMenuOpen(null)
    setMoveMenuAgentId(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Move failed (${res.status})`)
      }
      setAgents(prev => prev.map(a => (a.id === agentId ? { ...a, folderId } : a)))
    } catch (err: any) {
      console.error('moveAgentToFolder:', err)
      setActionFlash({ agentId, kind: 'err', msg: err.message ?? 'Move failed' })
    }
  }

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

  // Duplicate — full deep copy into the same workspace. Lands paused so
  // operators re-review before re-enabling channels.
  async function duplicateAgent(agentId: string) {
    setActionBusy(agentId)
    setMenuOpen(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Duplicate failed (${res.status})`)
      setActionFlash({ agentId, kind: 'ok', msg: `Copied as "${data.agent.name}" — jumping there now…` })
      // Refresh list so the copy appears while we navigate.
      fetchAgents()
      router.push(`/dashboard/${workspaceId}/agents/${data.agent.id}`)
    } catch (err: any) {
      setActionFlash({ agentId, kind: 'err', msg: err.message ?? 'Duplicate failed' })
    } finally {
      setActionBusy(null)
    }
  }

  // Save as template — snapshots every relation and stores as a
  // workspace-scoped AgentTemplate.
  async function saveAsTemplate(agentId: string, agentName: string) {
    // Simple prompt for a template name. Keeps the common case one click
    // away; a dedicated modal can come later if we add more fields.
    const name = window.prompt('Template name', `${agentName} template`)
    if (!name) return
    setActionBusy(agentId)
    setMenuOpen(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/save-as-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`)
      setActionFlash({ agentId, kind: 'ok', msg: `Saved "${data.template.name}" to Templates.` })
    } catch (err: any) {
      setActionFlash({ agentId, kind: 'err', msg: err.message ?? 'Save failed' })
    } finally {
      setActionBusy(null)
    }
  }

  // ─── Filtered view ───────────────────────────────────────────────────
  // Apply the active-folder pill. null = show all; UNFILED = only agents
  // with folderId === null; otherwise filter by that folderId.
  const visibleAgents = useMemo(() => {
    if (activeFolder === null) return agents
    if (activeFolder === UNFILED) return agents.filter(a => !a.folderId)
    return agents.filter(a => a.folderId === activeFolder)
  }, [agents, activeFolder])

  // Per-folder agent counts for the pill badges. Computed off the full
  // list so the count doesn't change when a pill is active.
  const counts = useMemo(() => {
    const map: Record<string, number> = { __all: agents.length, [UNFILED]: 0 }
    for (const f of folders) map[f.id] = 0
    for (const a of agents) {
      if (a.folderId && map[a.folderId] !== undefined) map[a.folderId]++
      else map[UNFILED]++
    }
    return map
  }, [agents, folders])

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
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Text agents</h1>
            <p className="text-sm text-zinc-400 mt-1">
              SMS, WhatsApp, email, and live chat. For phone calls, head to{' '}
              <Link href={`/dashboard/${workspaceId}/voice`} className="underline" style={{ color: 'var(--accent-primary)' }}>
                Voice agents
              </Link>
              .
            </p>
          </div>

          <NewTextAgentButton workspaceId={workspaceId} atLimit={atLimit} />
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

        {/* ─── Misconfigured-agents banner ─────────────────────────────── */}
        {/* Surface every active agent that won't actually receive inbounds
            (no routing rule and/or no channel deployment). The per-card
            "Not deployed · fix" pill is easy to miss at a glance — this
            banner names every offending agent with a direct link to its
            routing tab. Hidden when nothing is misconfigured so the
            surface stays clean during the happy path. */}
        {(() => {
          const misconfigured = agents.filter(a => getListeningState(a).state === 'misconfigured')
          if (misconfigured.length === 0) return null
          return (
            <div
              className="mb-6 p-4 rounded-xl border"
              style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
            >
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent-amber)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M5.07 19h13.86c1.54 0 2.5-1.67 1.73-3L13.73 4a2 2 0 00-3.46 0L3.34 16c-.77 1.33.19 3 1.73 3z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>
                    {misconfigured.length === 1
                      ? '1 agent will not receive inbound messages'
                      : `${misconfigured.length} agents will not receive inbound messages`}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                    Active agents without a routing rule or channel deployment are silently skipped on every inbound. Add at least one routing rule and one channel deployment to start listening.
                  </p>
                  <ul className="mt-3 space-y-1">
                    {misconfigured.map(a => {
                      const status = getListeningState(a)
                      return (
                        <li key={a.id} className="text-xs flex items-center gap-2">
                          <span style={{ color: 'var(--text-primary)' }}>{a.name}</span>
                          <span style={{ color: 'var(--text-tertiary)' }}>—</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{status.reason}</span>
                          <Link
                            href={`/dashboard/${workspaceId}/agents/${a.id}/routing`}
                            className="ml-auto font-medium hover:underline"
                            style={{ color: 'var(--accent-amber)' }}
                          >
                            Fix →
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              </div>
            </div>
          )
        })()}

        {/* ─── Folders bar ─────────────────────────────────────────────
            Pill row: All · <folder pills> · Unfiled · + Folder. Clicking
            a pill filters the grid below; clicking the active pill
            again clears the filter. Per-folder pill includes inline
            rename (double-click the label) and a delete (×) on hover.

            Hidden entirely when the schema hasn't yet picked up the
            AgentFolder table (notMigrated=true from the API), so a
            fresh deploy doesn't show a broken UI for a few seconds.
            Also hidden when there are zero agents to keep the empty
            state clean — folders are an organising tool, they don't
            need to appear before there's anything to organise. */}
        {foldersAvailable && agents.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveFolder(null)}
              className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
              style={{
                background: activeFolder === null ? 'rgba(250,77,46,0.15)' : 'var(--surface-secondary)',
                color: activeFolder === null ? '#fa4d2e' : 'var(--text-secondary)',
              }}
            >
              All <span className="opacity-60 ml-1">{counts.__all}</span>
            </button>

            {folders.map(folder => {
              const isActive = activeFolder === folder.id
              const isEditing = editingFolderId === folder.id
              return (
                <div key={folder.id} className="relative group/folder inline-flex items-center">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingFolderName}
                      onChange={e => setEditingFolderName(e.target.value)}
                      onBlur={() => renameFolder(folder.id)}
                      onKeyDown={e => {
                        if (e.key === 'Enter') renameFolder(folder.id)
                        if (e.key === 'Escape') setEditingFolderId(null)
                      }}
                      className="text-xs font-medium px-3 py-1.5 rounded-full focus:outline-none"
                      style={{
                        background: 'var(--input-bg)',
                        border: '1px solid var(--input-border)',
                        color: 'var(--input-text)',
                        minWidth: 80,
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => setActiveFolder(isActive ? null : folder.id)}
                      onDoubleClick={() => {
                        setEditingFolderId(folder.id)
                        setEditingFolderName(folder.name)
                      }}
                      className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                      title="Click to filter · Double-click to rename"
                      style={{
                        background: isActive ? 'rgba(250,77,46,0.15)' : 'var(--surface-secondary)',
                        color: isActive ? '#fa4d2e' : 'var(--text-secondary)',
                      }}
                    >
                      {folder.name}
                      <span className="opacity-60 ml-1">{counts[folder.id] ?? 0}</span>
                    </button>
                  )}
                  {!isEditing && (
                    <button
                      onClick={() => deleteFolder(folder.id)}
                      className="ml-1 opacity-0 group-hover/folder:opacity-100 transition-opacity text-zinc-500 hover:text-red-400 text-xs"
                      title="Delete folder (agents inside become Unfiled)"
                    >
                      ×
                    </button>
                  )}
                </div>
              )
            })}

            {/* "Unfiled" pill only renders when there are actually some
                unfiled agents AND at least one folder exists. With zero
                folders, the All pill already covers everything. */}
            {folders.length > 0 && counts[UNFILED] > 0 && (
              <button
                onClick={() => setActiveFolder(activeFolder === UNFILED ? null : UNFILED)}
                className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors"
                style={{
                  background: activeFolder === UNFILED ? 'rgba(250,77,46,0.15)' : 'var(--surface-secondary)',
                  color: activeFolder === UNFILED ? '#fa4d2e' : 'var(--text-tertiary)',
                }}
              >
                Unfiled <span className="opacity-60 ml-1">{counts[UNFILED]}</span>
              </button>
            )}

            {/* + Folder — inline-prompt UX matches WidgetFolder's recent
                redesign and avoids a modal for a single-field create. */}
            {newFolderOpen ? (
              <div className="inline-flex items-center gap-1">
                <input
                  autoFocus
                  value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onBlur={createFolder}
                  onKeyDown={e => {
                    if (e.key === 'Enter') createFolder()
                    if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName('') }
                  }}
                  placeholder="Folder name"
                  className="text-xs font-medium px-3 py-1.5 rounded-full focus:outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--input-text)',
                    minWidth: 120,
                  }}
                />
              </div>
            ) : (
              <button
                onClick={() => setNewFolderOpen(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-full transition-colors flex items-center gap-1"
                style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
              >
                + Folder
                <NewBadge since="2026-05-29" />
              </button>
            )}
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
            <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>No agents yet</h3>
            <p className="text-sm text-zinc-400 text-center max-w-sm mb-6">
              Create your first AI agent to start automating conversations across SMS, WhatsApp, Email, and more.
            </p>
            <Link
              href={`/dashboard/${workspaceId}/agents/new`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
              style={{ background: '#fa4d2e', color: '#fff' }}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Create Agent
            </Link>
          </div>
        ) : (
          /* ─── Agent Grid ─────────────────────────────────────────────── */
          visibleAgents.length === 0 ? (
            // Filter active but nothing in this folder. Soft message
            // rather than the big "No agents yet" empty state, since
            // the workspace clearly has agents — they're just elsewhere.
            <div
              className="text-sm text-center py-12 px-4 rounded-xl border border-dashed"
              style={{ borderColor: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}
            >
              No agents in this folder yet. Use the ⋯ menu on any agent to move it here.
            </div>
          ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleAgents.map(agent => (
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
                        className="text-base font-semibold hover:underline truncate block" style={{ color: 'var(--text-primary)' }}
                      >
                        {/* Voice agents get a 🎤 prefix so they're
                            visually distinct from text agents at a
                            glance in a mixed-list workspace. */}
                        {agent.agentType === 'VOICE' && <span className="mr-1.5" aria-hidden>🎤</span>}
                        {agent.name}
                      </Link>
                      {(() => {
                        const status = getListeningState(agent)
                        // CSS-token styling so the pill sits in the same
                        // visual register as every other status surface in
                        // the app (theme-aware, no hardcoded RGB).
                        const tone: Record<ListeningState, { bg: string; fg: string; dot: string }> = {
                          live: {
                            bg:  'var(--accent-emerald-bg)',
                            fg:  'var(--accent-emerald)',
                            dot: 'var(--accent-emerald)',
                          },
                          misconfigured: {
                            bg:  'var(--accent-amber-bg)',
                            fg:  'var(--accent-amber)',
                            dot: 'var(--accent-amber)',
                          },
                          off: {
                            bg:  'var(--surface-secondary)',
                            fg:  'var(--text-tertiary)',
                            dot: 'var(--text-tertiary)',
                          },
                        }
                        const s = tone[status.state]
                        const pill = (
                          <span
                            className="inline-flex items-center gap-1.5 mt-1.5 text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ background: s.bg, color: s.fg }}
                            title={status.reason}
                          >
                            <span
                              className="inline-block w-1.5 h-1.5 rounded-full"
                              style={{ background: s.dot }}
                            />
                            {status.label}
                            {status.state === 'misconfigured' && (
                              <span className="opacity-60">· fix</span>
                            )}
                          </span>
                        )
                        return status.fixHref ? (
                          <Link
                            href={`/dashboard/${workspaceId}/agents/${agent.id}/${status.fixHref}`}
                            className="inline-block transition-opacity hover:opacity-80"
                          >
                            {pill}
                          </Link>
                        ) : pill
                      })()}
                    </div>

                    {/* Active toggle */}
                    <button
                      onClick={() => toggleActive(agent.id, agent.isActive)}
                      disabled={togglingId === agent.id}
                      className="shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                      style={{
                        background: agent.isActive ? '#22c55e' : 'var(--toggle-off-bg)',
                        opacity: togglingId === agent.id ? 0.5 : 1,
                      }}
                      title={agent.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'}
                    >
                      <span
                        className="inline-block h-4 w-4 rounded-full transition-transform duration-200"
                        style={{
                          background: '#fff',
                          transform: agent.isActive ? 'translateX(22px)' : 'translateX(4px)',
                        }}
                      />
                    </button>
                  </div>

                  {/* Channel badges — VOICE agents always show a Voice
                      pill (voice IS the channel) regardless of the
                      ChannelDeployment table; text agents render whatever
                      channels they've deployed plus a Voice pill if
                      they've bolted voice on. */}
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {agent.agentType === 'VOICE' ? (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                      >
                        Voice
                      </span>
                    ) : agent.channelDeployments.length > 0 ? (
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
                    {agent.agentType !== 'VOICE' && agent.vapiConfig?.isActive && (
                      <span
                        className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                        style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
                      >
                        Voice
                      </span>
                    )}
                  </div>

                  {/* Connected-to line — surfaces the CRM sub-account
                      business name (joined from MarketplaceInstall) so
                      the operator can see which LeadConnector location
                      this agent is wired to without clicking through.
                      Format: "<BusinessName> (<linked locationId>)".
                      The locationId itself is a hyperlink into the
                      whitelabel LC dashboard (app.voxility.ai by
                      default; configurable via env). Fallback chain:
                        1. businessName + linked locationId (real install
                           with a snapshot)
                        2. Just the linked locationId (snapshot hasn't
                           backfilled yet)
                        3. "Native CRM" / "No CRM connected" label only
                           for native/placeholder rows (no external
                           dashboard to link to) */}
                  {(() => {
                    const c = agent.connection
                    if (!c) return null
                    const label = c.businessName
                      ? c.businessName
                      : c.provider === 'native'
                        ? 'Native CRM'
                        : c.provider === 'none'
                          ? 'No CRM connected'
                          : null
                    const dashHref = getLocationDashboardUrl(c.locationId, c.provider)
                    return (
                      <p
                        className="text-[11px] mb-3 flex items-center gap-1 min-w-0"
                        style={{ color: 'var(--text-tertiary)' }}
                        title={c.locationId}
                      >
                        <svg className="w-3 h-3 flex-shrink-0 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        {label && <span className="truncate">{label}</span>}
                        {dashHref ? (
                          <a
                            href={dashHref}
                            target="_blank"
                            rel="noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="font-mono truncate hover:underline"
                            style={{ color: 'var(--text-muted)' }}
                            title="Open in LeadConnector"
                          >
                            {label ? `(${c.locationId})` : c.locationId}
                          </a>
                        ) : !label ? (
                          // No real label (so no native/none copy) and
                          // no dashboard URL — render the bare id so we
                          // at least show something for diagnostics.
                          <span className="font-mono truncate select-all" style={{ color: 'var(--text-muted)' }}>
                            {c.locationId}
                          </span>
                        ) : null}
                      </p>
                    )
                  })()}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-3 py-3 border-t border-zinc-800">
                    <div>
                      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{agent._count.messageLogs.toLocaleString()}</p>
                      <p className="text-[11px] text-zinc-500">Messages</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{agent._count.conversationStates}</p>
                      <p className="text-[11px] text-zinc-500">Conversations</p>
                    </div>
                    <div>
                      <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{agent._count.attachedCollections ?? agent._count.attachedKnowledge ?? agent._count.knowledgeEntries ?? 0}</p>
                      <p className="text-[11px] text-zinc-500">Collections</p>
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

                  {/* Next actions indicator */}
                  {agent.nextActions?.count > 0 && (
                    <Link
                      href={`/dashboard/${workspaceId}/next-actions?agentId=${agent.id}`}
                      className="flex items-center justify-between gap-2 mt-3 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:bg-zinc-900/80 transition-colors group/next"
                    >
                      <div className="flex items-center gap-2">
                        <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-[11px] font-medium text-zinc-300">
                          {agent.nextActions.count} scheduled
                        </span>
                      </div>
                      <span className="text-[11px] text-amber-400 font-medium">
                        {formatNextActionTime(agent.nextActions.nextAt)}
                      </span>
                    </Link>
                  )}

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
                      className="flex-1 text-center text-xs font-medium py-2 rounded-lg transition-colors hover:opacity-90"
                      style={{ background: 'rgba(250,77,46,0.8)', color: '#fff' }}
                    >
                      Deploy
                    </Link>

                    {/* Overflow menu: Duplicate + Save as template. Wraps
                        the existing Delete button so all secondary actions
                        are one place. */}
                    <div className="relative">
                      <button
                        onClick={() => setMenuOpen(menuOpen === agent.id ? null : agent.id)}
                        disabled={actionBusy === agent.id}
                        className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
                        title="More actions"
                      >
                        {actionBusy === agent.id ? (
                          <span className="block w-4 h-4 border-2 border-zinc-600 border-t-white rounded-full animate-spin" />
                        ) : (
                          <span className="block w-4 text-center leading-none">⋯</span>
                        )}
                      </button>
                      {menuOpen === agent.id && (
                        <div className="absolute right-0 bottom-full mb-1 w-52 rounded-lg border border-zinc-700 bg-zinc-950 shadow-lg z-20 overflow-hidden">
                          <button
                            onClick={() => duplicateAgent(agent.id)}
                            className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors"
                          >
                            Duplicate agent
                            <span className="block text-[10px] text-zinc-600 mt-0.5">Deep copy — paused by default</span>
                          </button>
                          <button
                            onClick={() => saveAsTemplate(agent.id, agent.name)}
                            className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors border-t border-zinc-800"
                          >
                            Save as template
                            <span className="block text-[10px] text-zinc-600 mt-0.5">Reuse this agent's full config</span>
                          </button>
                          {/* Move to folder — hidden when no folders exist
                              and when the schema isn't migrated, since
                              there's nowhere to move TO. */}
                          {foldersAvailable && folders.length > 0 && (
                            <>
                              <button
                                onClick={() => setMoveMenuAgentId(moveMenuAgentId === agent.id ? null : agent.id)}
                                className="w-full text-left px-3 py-2 text-xs text-zinc-200 hover:bg-zinc-900 transition-colors border-t border-zinc-800 flex items-center justify-between"
                              >
                                <span>Move to folder…</span>
                                <span className="text-zinc-500">›</span>
                              </button>
                              {moveMenuAgentId === agent.id && (
                                <div className="bg-zinc-900/60 border-t border-zinc-800 max-h-48 overflow-y-auto">
                                  {agent.folderId && (
                                    <button
                                      onClick={() => moveAgentToFolder(agent.id, null)}
                                      className="w-full text-left px-5 py-1.5 text-[11px] text-zinc-400 hover:bg-zinc-800 transition-colors italic"
                                    >
                                      Remove from folder
                                    </button>
                                  )}
                                  {folders.filter(f => f.id !== agent.folderId).map(f => (
                                    <button
                                      key={f.id}
                                      onClick={() => moveAgentToFolder(agent.id, f.id)}
                                      className="w-full text-left px-5 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800 transition-colors"
                                    >
                                      {f.name}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                          <button
                            onClick={() => { setMenuOpen(null); setDeleteConfirm(agent.id) }}
                            className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 transition-colors border-t border-zinc-800"
                          >
                            Delete agent
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Confirm-delete footer (kept outside the menu so it's
                      clearly a two-step action) */}
                  {deleteConfirm === agent.id && (
                    <div
                      className="mt-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2"
                      style={{ background: 'var(--accent-red-bg)', borderColor: 'var(--accent-red)' }}
                    >
                      <p className="text-xs font-medium" style={{ color: 'var(--accent-red)' }}>
                        Delete this agent and all its data?
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => deleteAgent(agent.id)}
                          className="text-xs font-semibold py-1.5 px-3 rounded transition-opacity hover:opacity-90"
                          style={{ background: 'var(--accent-red)', color: '#ffffff' }}
                        >
                          Confirm delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="text-xs font-medium py-1.5 px-2 rounded transition-colors"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Action result flash (duplicate succeeded / save
                      succeeded / error message) */}
                  {actionFlash?.agentId === agent.id && (
                    <p className={`mt-2 text-xs ${actionFlash.kind === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                      {actionFlash.msg}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
          )
        )}
      </div>
    </div>
  )
}

// ─── + New text agent button ────────────────────────────────────────
// Voice agents have their own dedicated section (/voice) with their
// own "+ New voice agent" CTA, so this page's new-agent button is a
// single text-only entry — no dropdown needed.
function NewTextAgentButton({ workspaceId, atLimit }: { workspaceId: string; atLimit: boolean }) {
  return (
    <Link
      href={atLimit ? '#' : `/dashboard/${workspaceId}/agents/new`}
      onClick={e => { if (atLimit) e.preventDefault() }}
      aria-disabled={atLimit}
      className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
        atLimit ? 'cursor-not-allowed' : 'hover:opacity-90'
      }`}
      style={
        atLimit
          ? { background: 'var(--surface-tertiary)', color: 'var(--text-muted)' }
          : { background: '#fa4d2e', color: '#fff' }
      }
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
      New text agent
    </Link>
  )
}
