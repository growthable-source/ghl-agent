'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { getLocationDashboardUrl } from '@/lib/leadconnector-dashboard-url'
import {
  agentKpis, channelsInUse, filterAndSort, getListeningState, initials, rowChannels, timeAgo,
  type ListeningState, type SortKey, type StatusFilter, type ChannelPillKind,
} from '@/lib/agents-list'
import { AlertBanner, ChannelPill, KpiTile, PageHeader, StatusBadge } from '@/components/ui/primitives'
import Toggle from '@/components/ui/Toggle'
import { buttonClass, cx } from '@/lib/ui-classes'

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

interface AgentsMeta {
  total: number
  limit: number | null
  plan: string
}

// Listening status, channel mapping, filtering and KPIs live in lib/agents-list.ts (unit-tested).

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

  // ─── List controls (search / status / channel / sort / selection) ────────
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('any')
  const [channelFilter, setChannelFilter] = useState<ChannelPillKind | 'any'>('any')
  const [sort, setSort] = useState<SortKey>('updated')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const rows = useMemo(
    () => filterAndSort(visibleAgents, { query, status: statusFilter, channel: channelFilter, sort }),
    [visibleAgents, query, statusFilter, channelFilter, sort],
  )
  const kpis = useMemo(() => agentKpis(agents), [agents])
  const channelOptions = useMemo(() => channelsInUse(agents), [agents])
  const allSelected = rows.length > 0 && rows.every(r => selected.has(r.id))

  function toggleSelected(id: string) {
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  // Bulk actions reuse the single-agent handlers; sequential so a failure
  // on one row doesn't race the others' optimistic state updates.
  async function bulkSetActive(active: boolean) {
    setBulkBusy(true)
    for (const a of agents.filter(x => selected.has(x.id) && x.isActive !== active)) {
      await toggleActive(a.id, a.isActive)
    }
    setBulkBusy(false)
  }
  async function bulkDelete() {
    if (!window.confirm(`Delete ${selected.size} agent${selected.size === 1 ? '' : 's'} and all their data? This can't be undone.`)) return
    setBulkBusy(true)
    for (const id of Array.from(selected)) await deleteAgent(id)
    setSelected(new Set())
    setBulkBusy(false)
  }

  // ─── Plan usage ────────────────────────────────────────────────────────────

  const usedCount = meta?.total ?? agents.length
  const limitCount = meta?.limit
  const atLimit = limitCount ? usedCount >= limitCount : false
  const planLabel = meta?.plan ? `${meta.plan.charAt(0).toUpperCase()}${meta.plan.slice(1)} plan` : undefined

  // ─── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex-1 p-6">
        <div className="h-7 w-48 rounded bg-surface-tertiary animate-pulse mb-6" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-[88px] xv-card animate-pulse" />)}
        </div>
        <div className="h-72 xv-card animate-pulse" />
      </div>
    )
  }

  const pillBase = 'h-7 px-2.5 rounded text-[12px] font-medium transition-colors cursor-pointer'
  const selectCls = 'h-8 rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] text-text-primary cursor-pointer'

  return (
    <div className="flex-1 p-6 overflow-y-auto">
      <div className="max-w-[1200px] mx-auto space-y-4">

        {/* The misconfigured banner names the problem once; each row's status
            pill links straight to the fix (routing tab). */}
        {kpis.needAttention > 0 && (
          <AlertBanner lead={kpis.needAttention === 1 ? '1 agent will not receive inbound messages.' : `${kpis.needAttention} agents will not receive inbound messages.`}>
            Active agents need at least one routing rule and one channel deployment — otherwise every inbound is skipped.
          </AlertBanner>
        )}
        {atLimit && (
          <AlertBanner tone="danger" lead="Agent limit reached." action={
            <Link href={`/dashboard/${workspaceId}/settings/billing`} className={buttonClass('primary', 'sm')}>Upgrade</Link>
          }>
            Upgrade your plan or add agent slots to create more.
          </AlertBanner>
        )}

        <PageHeader
          title="Text agents"
          subtitle={<>AI agents for SMS, WhatsApp, email and live chat. Phone agents live in{' '}
            <Link href={`/dashboard/${workspaceId}/voice`} className="text-brand-500 hover:underline">Voice agents</Link>.</>}
          actions={<NewTextAgentButton workspaceId={workspaceId} atLimit={atLimit} />}
        />

        {/* TODO(redesign-followup): "Avg. success rate" KPI, per-agent health score, 7-day sparkline, success % and deployed-version columns — no data source yet. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Live agents" value={`${kpis.live} / ${kpis.total}`}
            delta={kpis.needAttention > 0 ? `${kpis.needAttention} need attention` : undefined} deltaTone="warning" />
          <KpiTile label="Conversations" value={kpis.conversations.toLocaleString()} />
          <KpiTile label="Messages" value={kpis.messages.toLocaleString()} />
          <KpiTile label="Plan usage"
            value={limitCount != null ? `${usedCount} of ${limitCount.toLocaleString()}` : String(usedCount)}
            suffix={planLabel} />
        </div>

        {agents.length === 0 ? (
          <div className="xv-card border-dashed flex flex-col items-center justify-center py-16 px-6 text-center">
            <h3 className="text-[15px] font-semibold text-text-primary mb-1">No agents yet</h3>
            <p className="text-[13px] text-text-tertiary max-w-sm mb-5">
              Create your first AI agent to start automating conversations across SMS, WhatsApp, email and more.
            </p>
            <Link href={`/dashboard/${workspaceId}/agents/new`} className={buttonClass('primary')}>+ New text agent</Link>
          </div>
        ) : (
          <div className="xv-card">
            {/* ─── Toolbar: folders · search · filters · sort ─── */}
            <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border-theme">
              {foldersAvailable && (
                <div className="flex flex-wrap items-center gap-1 rounded-md bg-surface-secondary p-0.5">
                  <button onClick={() => setActiveFolder(null)}
                    className={cx(pillBase, activeFolder === null ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary')}>
                    All <span className="text-text-muted tabular-nums">{counts.__all}</span>
                  </button>
                  {folders.map(folder => {
                    const isActive = activeFolder === folder.id
                    return editingFolderId === folder.id ? (
                      <input key={folder.id} autoFocus value={editingFolderName}
                        onChange={e => setEditingFolderName(e.target.value)}
                        onBlur={() => renameFolder(folder.id)}
                        onKeyDown={e => { if (e.key === 'Enter') renameFolder(folder.id); if (e.key === 'Escape') setEditingFolderId(null) }}
                        className="h-7 px-2 rounded text-[12px] bg-surface border border-border-theme outline-none min-w-[80px]" />
                    ) : (
                      <span key={folder.id} className="group/folder inline-flex items-center">
                        <button
                          onClick={() => setActiveFolder(isActive ? null : folder.id)}
                          onDoubleClick={() => { setEditingFolderId(folder.id); setEditingFolderName(folder.name) }}
                          title="Click to filter · Double-click to rename"
                          className={cx(pillBase, isActive ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary')}>
                          {folder.name} <span className="text-text-muted tabular-nums">{counts[folder.id] ?? 0}</span>
                        </button>
                        <button onClick={() => deleteFolder(folder.id)} title="Delete folder (agents inside become Unfiled)"
                          className="opacity-0 group-hover/folder:opacity-100 px-1 text-[12px] text-text-muted hover:text-red-600 cursor-pointer">×</button>
                      </span>
                    )
                  })}
                  {folders.length > 0 && counts[UNFILED] > 0 && (
                    <button onClick={() => setActiveFolder(activeFolder === UNFILED ? null : UNFILED)}
                      className={cx(pillBase, activeFolder === UNFILED ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary')}>
                      Unfiled <span className="text-text-muted tabular-nums">{counts[UNFILED]}</span>
                    </button>
                  )}
                  {newFolderOpen ? (
                    <input autoFocus value={newFolderName} placeholder="Folder name"
                      onChange={e => setNewFolderName(e.target.value)} onBlur={createFolder}
                      onKeyDown={e => { if (e.key === 'Enter') createFolder(); if (e.key === 'Escape') { setNewFolderOpen(false); setNewFolderName('') } }}
                      className="h-7 px-2 rounded text-[12px] bg-surface border border-border-theme outline-none min-w-[110px]" />
                  ) : (
                    <button onClick={() => setNewFolderOpen(true)} className={cx(pillBase, 'text-text-muted hover:text-text-primary')}>+ Folder</button>
                  )}
                </div>
              )}

              <div className="flex-1" />
              <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search agents…" aria-label="Search agents"
                className="h-8 w-[200px] rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] outline-none focus:border-brand-500" />
              <select aria-label="Status" value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} className={selectCls}>
                <option value="any">Status: Any</option>
                <option value="live">Listening</option>
                <option value="misconfigured">Not deployed</option>
                <option value="off">Off</option>
              </select>
              {channelOptions.length > 0 && (
                <select aria-label="Channel" value={channelFilter} onChange={e => setChannelFilter(e.target.value as ChannelPillKind | 'any')} className={selectCls}>
                  <option value="any">Channel: Any</option>
                  {channelOptions.map(c => <option key={c} value={c}>{c === 'chat' ? 'Live Chat' : c === 'sms' ? 'SMS' : c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
                </select>
              )}
              <select aria-label="Sort" value={sort} onChange={e => setSort(e.target.value as SortKey)} className={selectCls}>
                <option value="updated">Sort: Last updated</option>
                <option value="name">Sort: Name</option>
                <option value="conversations">Sort: Conversations</option>
              </select>
              {/* TODO(redesign-followup): list/grid view toggle — the card grid was retired; add back if wanted. */}
            </div>

            {rows.length === 0 ? (
              <p className="py-12 text-center text-[13px] text-text-tertiary">
                {activeFolder && agents.length > 0 && visibleAgents.length === 0
                  ? 'No agents in this folder yet. Use the ⋯ menu on any agent to move it here.'
                  : 'No agents match these filters.'}
              </p>
            ) : (
              <table className="w-full text-[13px] text-text-primary">
                <thead className="border-b border-border-theme">
                  <tr>
                    <th className="h-9 w-10 pl-4 text-left">
                      <input type="checkbox" aria-label="Select all" checked={allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map(r => r.id)))} />
                    </th>
                    {['Agent', 'Status', 'Channels', 'Conversations', 'Tools · Rules', 'Updated'].map(h => (
                      <th key={h} className="h-9 px-3 text-left text-[11px] uppercase tracking-wider font-semibold text-text-muted">{h}</th>
                    ))}
                    <th className="w-[150px]" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(agent => {
                    const status = getListeningState(agent as never)
                    const kind = ({ live: 'live', misconfigured: 'attention', off: 'paused' } as const)[status.state as ListeningState]
                    const chans = rowChannels(agent)
                    const c = agent.connection
                    const connLabel = c ? (c.businessName ?? (c.provider === 'native' ? 'Native CRM' : c.provider === 'none' ? 'No CRM connected' : null)) : null
                    const dashHref = c ? getLocationDashboardUrl(c.locationId, c.provider) : null
                    const isSel = selected.has(agent.id)
                    return (
                      <FragmentRow key={agent.id}>
                        <tr className={cx('border-b border-border-theme last:border-0 transition-colors', isSel ? 'bg-brand-50' : 'hover:bg-surface-secondary/60')}>
                          <td className="pl-4"><input type="checkbox" aria-label={`Select ${agent.name}`} checked={isSel} onChange={() => toggleSelected(agent.id)} /></td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <span className="h-8 w-8 shrink-0 rounded-md bg-surface-secondary text-[11px] font-semibold text-text-secondary flex items-center justify-center">{initials(agent.name)}</span>
                              <div className="min-w-0">
                                <Link href={`/dashboard/${workspaceId}/agents/${agent.id}`} className="block font-medium truncate hover:underline">
                                  {agent.agentType === 'VOICE' && <span className="mr-1" aria-hidden>🎤</span>}{agent.name}
                                </Link>
                                <p className="text-[11.5px] text-text-tertiary truncate" title={c?.locationId}>
                                  {connLabel ?? (c ? '' : '—')}
                                  {dashHref && (
                                    <a href={dashHref} target="_blank" rel="noreferrer" title="Open in LeadConnector" className="font-mono text-text-muted hover:underline ml-1">
                                      {connLabel ? `(${c!.locationId})` : c!.locationId}
                                    </a>
                                  )}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3">
                            {status.fixHref ? (
                              <Link href={`/dashboard/${workspaceId}/agents/${agent.id}/${status.fixHref}`} title={status.reason}>
                                <StatusBadge status={kind} label={`${status.label} · fix`} />
                              </Link>
                            ) : <span title={status.reason}><StatusBadge status={kind} label={status.label === 'Listening' ? 'Live' : status.label} /></span>}
                          </td>
                          <td className="px-3">
                            <div className="flex flex-wrap gap-1">
                              {chans.length > 0 ? chans.map(k => <ChannelPill key={k} channel={k} />) : <span className="text-[11.5px] italic text-text-muted">None deployed</span>}
                            </div>
                          </td>
                          <td className="px-3 tabular-nums">
                            {agent._count.conversationStates.toLocaleString()}
                            {agent.nextActions?.count > 0 && (
                              <Link href={`/dashboard/${workspaceId}/next-actions?agentId=${agent.id}`} className="ml-2 text-[11.5px] text-amber-600 hover:underline" title="Scheduled follow-ups">
                                {agent.nextActions.count} scheduled
                              </Link>
                            )}
                          </td>
                          <td className="px-3 tabular-nums text-text-secondary">{agent.enabledTools?.length || 0} · {agent._count.routingRules}</td>
                          <td className="px-3 text-text-secondary whitespace-nowrap">{timeAgo(agent.updatedAt)}</td>
                          <td className="pr-3">
                            <div className="flex items-center justify-end gap-2">
                              <Toggle checked={agent.isActive} disabled={togglingId === agent.id}
                                onChange={() => toggleActive(agent.id, agent.isActive)}
                                title={agent.isActive ? 'Active — click to deactivate' : 'Inactive — click to activate'} />
                              <Link href={`/dashboard/${workspaceId}/agents/${agent.id}`} className={buttonClass('secondary', 'sm')}>Edit</Link>
                              <div className="relative">
                                <button onClick={() => setMenuOpen(menuOpen === agent.id ? null : agent.id)} disabled={actionBusy === agent.id}
                                  title="More actions" aria-label="More actions"
                                  className="h-7 w-7 rounded-md text-text-tertiary hover:bg-surface-secondary cursor-pointer disabled:opacity-50">
                                  {actionBusy === agent.id ? <span className="block mx-auto w-4 h-4 border-2 border-border-secondary border-t-text-primary rounded-full animate-spin" /> : '⋯'}
                                </button>
                                {menuOpen === agent.id && (
                                  <div className="absolute right-0 top-8 w-52 xv-card shadow-xl z-20 overflow-hidden text-[12.5px]">
                                    <Link href={`/dashboard/${workspaceId}/agents/${agent.id}/deploy`} className="block px-3 py-2 hover:bg-surface-secondary">Deploy…</Link>
                                    <button onClick={() => duplicateAgent(agent.id)} className="w-full text-left px-3 py-2 hover:bg-surface-secondary border-t border-border-theme cursor-pointer">
                                      Duplicate agent<span className="block text-[10.5px] text-text-muted">Deep copy — paused by default</span>
                                    </button>
                                    <button onClick={() => saveAsTemplate(agent.id, agent.name)} className="w-full text-left px-3 py-2 hover:bg-surface-secondary border-t border-border-theme cursor-pointer">
                                      Save as template<span className="block text-[10.5px] text-text-muted">Reuse this agent&apos;s full config</span>
                                    </button>
                                    {foldersAvailable && folders.length > 0 && (
                                      <>
                                        <button onClick={() => setMoveMenuAgentId(moveMenuAgentId === agent.id ? null : agent.id)}
                                          className="w-full text-left px-3 py-2 hover:bg-surface-secondary border-t border-border-theme flex justify-between cursor-pointer">
                                          <span>Move to folder…</span><span className="text-text-muted">›</span>
                                        </button>
                                        {moveMenuAgentId === agent.id && (
                                          <div className="bg-surface-secondary border-t border-border-theme max-h-48 overflow-y-auto">
                                            {agent.folderId && <button onClick={() => moveAgentToFolder(agent.id, null)} className="w-full text-left px-5 py-1.5 text-[11.5px] italic text-text-tertiary hover:bg-surface-tertiary cursor-pointer">Remove from folder</button>}
                                            {folders.filter(f => f.id !== agent.folderId).map(f => (
                                              <button key={f.id} onClick={() => moveAgentToFolder(agent.id, f.id)} className="w-full text-left px-5 py-1.5 text-[11.5px] hover:bg-surface-tertiary cursor-pointer">{f.name}</button>
                                            ))}
                                          </div>
                                        )}
                                      </>
                                    )}
                                    <button onClick={() => { setMenuOpen(null); setDeleteConfirm(agent.id) }}
                                      className="w-full text-left px-3 py-2 text-red-600 hover:bg-red-50 border-t border-border-theme cursor-pointer">Delete agent</button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                        {(deleteConfirm === agent.id || actionFlash?.agentId === agent.id) && (
                          <tr className="border-b border-border-theme">
                            <td colSpan={8} className="px-4 py-2">
                              {deleteConfirm === agent.id && (
                                <div className="flex items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2">
                                  <p className="text-[12.5px] font-medium text-red-700">Delete this agent and all its data?</p>
                                  <div className="flex items-center gap-2">
                                    <button onClick={() => deleteAgent(agent.id)} className={buttonClass('primary', 'sm')}>Confirm delete</button>
                                    <button onClick={() => setDeleteConfirm(null)} className={buttonClass('ghost', 'sm')}>Cancel</button>
                                  </div>
                                </div>
                              )}
                              {actionFlash?.agentId === agent.id && (
                                <p className={cx('text-[12.5px]', actionFlash.kind === 'ok' ? 'text-emerald-600' : 'text-red-600')}>{actionFlash.msg}</p>
                              )}
                            </td>
                          </tr>
                        )}
                      </FragmentRow>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      {/* Bulk-action bar (dark, floating) */}
      {selected.size > 0 && (
        <div role="toolbar" aria-label="Bulk actions"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 rounded-xl bg-stone-900 px-3 py-2 text-[13px] text-stone-50 shadow-xl">
          <span className="px-2 font-medium tabular-nums">{selected.size} selected</span>
          <span className="h-4 w-px bg-stone-700" />
          <button disabled={bulkBusy} onClick={() => bulkSetActive(true)} className="px-3 py-1 rounded hover:bg-stone-800 disabled:opacity-50 cursor-pointer">Activate</button>
          <button disabled={bulkBusy} onClick={() => bulkSetActive(false)} className="px-3 py-1 rounded hover:bg-stone-800 disabled:opacity-50 cursor-pointer">Pause</button>
          <button disabled={bulkBusy} onClick={bulkDelete} className="px-3 py-1 rounded text-red-300 hover:bg-stone-800 disabled:opacity-50 cursor-pointer">Delete</button>
          <button onClick={() => setSelected(new Set())} aria-label="Clear selection" className="px-2 py-1 rounded text-stone-400 hover:bg-stone-800 cursor-pointer">✕</button>
          {/* TODO(redesign-followup): bulk Deploy / Move to folder / Duplicate / Archive (no archive state exists; Delete is permanent). */}
        </div>
      )}
    </div>
  )
}

/** <tbody> may hold several <tr>s per agent (row + confirm/flash row). */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
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
      className={buttonClass('primary', 'md', atLimit ? 'opacity-50 pointer-events-none' : undefined)}
    >
      + New text agent
    </Link>
  )
}
