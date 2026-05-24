'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import NewBadge from '@/components/NewBadge'
import { LeadConnectorIcon, HubSpotIcon } from '@/components/icons/brand-icons'

interface RegistryEntry {
  slug: string
  name: string
  description: string
  iconUrl: string
  category: string
  defaultUrl: string
  authType: 'bearer' | 'header' | 'none'
  authHelp: string
  authHelpUrl?: string
  exampleRules?: Array<{ tool: string; whenToUse: string }>
}

interface DiscoveredTool { name: string; description: string; inputSchema: unknown }

interface McpServer {
  id: string
  name: string
  registrySlug: string | null
  description: string | null
  iconUrl: string | null
  url: string
  isActive: boolean
  lastDiscoveredAt: string | null
  discoveredTools: DiscoveredTool[] | null
}

interface Attachment {
  id: string
  agentId: string
  mcpServerId: string
  toolName: string
  enabled: boolean
  whenToUse: string | null
  mustIncludeKeywords: string[]
  requireApproval: boolean
}

type Tab = 'connected' | 'logs'
type CrmProvider = 'native' | 'ghl' | 'hubspot'

export default function AgentIntegrationsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [tab, setTab] = useState<Tab>('connected')
  const [servers, setServers] = useState<McpServer[]>([])
  const [registry, setRegistry] = useState<RegistryEntry[]>([])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [connectOpen, setConnectOpen] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)

  // ─── Per-agent CRM picker state ──────────────────────────────────────
  // currentCrm:    which CRM this agent is bound to (read from
  //                agent.location.crmProvider, normalised — 'none' rows
  //                render as 'native' for picker purposes).
  // availableCrms: which providers the workspace has actually connected.
  //                Unconnected options render disabled with a link back
  //                to workspace Integrations.
  // primaryCrm:    workspace.primaryCrmProvider — surfaces the "Workspace
  //                default" pill so users understand which option new
  //                agents inherit.
  const [currentCrm, setCurrentCrm] = useState<CrmProvider | null>(null)
  const [availableCrms, setAvailableCrms] = useState<Record<CrmProvider, boolean>>({ native: false, ghl: false, hubspot: false })
  const [primaryCrm, setPrimaryCrm] = useState<CrmProvider>('native')
  const [switchingCrm, setSwitchingCrm] = useState<CrmProvider | null>(null)
  const [crmBanner, setCrmBanner] = useState<{ kind: 'success' | 'error'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [serversRes, attRes, agentRes, wsIntRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/mcp-servers`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/mcp-tools`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/integrations`).then(r => r.json()),
      ])
      setServers(serversRes.servers || [])
      setRegistry(serversRes.registry || [])
      setAttachments(attRes.attachments || [])

      // Normalise the agent's current CRM. Location.crmProvider can be
      // 'none' (placeholder rows for agents created before any CRM was
      // connected) — those render as 'native' for picker purposes since
      // 'none' isn't a user-facing choice.
      const locProvider = agentRes?.agent?.location?.crmProvider as string | undefined
      const normalised: CrmProvider = locProvider === 'ghl' || locProvider === 'hubspot' || locProvider === 'native'
        ? locProvider
        : 'native'
      setCurrentCrm(normalised)

      // The integrations GET adds availableCrms + primaryCrmProvider on
      // the new schema. Older deploys (un-migrated DB) won't have these
      // — fall back to "everything available, primary=native".
      if (wsIntRes?.availableCrms) {
        setAvailableCrms({
          native: !!wsIntRes.availableCrms.native,
          ghl: !!wsIntRes.availableCrms.ghl,
          hubspot: !!wsIntRes.availableCrms.hubspot,
        })
      }
      if (wsIntRes?.primaryCrmProvider) {
        const p = wsIntRes.primaryCrmProvider as string
        if (p === 'native' || p === 'ghl' || p === 'hubspot') setPrimaryCrm(p)
      }

      if (serversRes.notMigrated || attRes.notMigrated) {
        setPageError('MCP connectors need a database migration — run prisma/migrations-legacy/manual_mcp_connectors.sql in Supabase.')
      } else if (serversRes.error || attRes.error) {
        setPageError(serversRes.error || attRes.error)
      } else {
        setPageError(null)
      }
    } catch (err: any) {
      setPageError(err?.message || 'Could not load integrations')
    } finally { setLoading(false) }
  }, [workspaceId, agentId])

  async function switchAgentCrm(provider: CrmProvider) {
    if (provider === currentCrm) return
    setSwitchingCrm(provider)
    setCrmBanner(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crmProvider: provider }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `HTTP ${res.status}`)
      }
      setCurrentCrm(provider)
      const labels: Record<CrmProvider, string> = { native: 'Native CRM', ghl: 'LeadConnector', hubspot: 'HubSpot' }
      setCrmBanner({ kind: 'success', text: `This agent now uses ${labels[provider]} for contacts, deals, and messaging.` })
    } catch (err: any) {
      setCrmBanner({ kind: 'error', text: err.message || 'Could not switch CRM' })
    } finally {
      setSwitchingCrm(null)
    }
  }

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="p-8"><div className="h-6 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Integrations</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Connect external MCP servers and write plain-English rules for when this agent should use them.
            The agent will follow your &quot;when to use&quot; instructions exactly — keep them specific.
          </p>
        </div>
        <button
          onClick={() => setConnectOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          + Connect MCP
        </button>
      </div>

      {pageError && (
        <div
          className="mb-4 p-3 rounded-lg text-xs"
          style={{ border: '1px solid var(--accent-amber)', background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
        >
          {pageError}
        </div>
      )}

      {/* ─── Per-agent CRM picker ─────────────────────────────────────
          Each agent in a workspace can target a different CRM. The
          schema's always supported this (Agent.locationId → Location.
          crmProvider) but until now the UI never surfaced it, so users
          assumed one CRM per workspace. The cards mirror the visual
          language of the workspace Integrations page. */}
      <div
        className="mb-6 rounded-xl border p-5"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex items-center justify-between mb-1">
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            CRM <NewBadge since="2026-05-25" className="ml-1" />
          </p>
          <Link
            href={`/dashboard/${workspaceId}/integrations`}
            className="text-xs hover:underline"
            style={{ color: 'var(--text-tertiary)' }}
          >
            Manage at workspace →
          </Link>
        </div>
        <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>
          Which CRM this agent reads from and writes to. Different agents in the same workspace can target different CRMs.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {([
            { value: 'native', label: 'Native CRM', sub: 'Built-in contacts + lists', Icon: null as null | typeof LeadConnectorIcon },
            { value: 'ghl', label: 'LeadConnector', sub: 'GoHighLevel CRM', Icon: LeadConnectorIcon },
            { value: 'hubspot', label: 'HubSpot', sub: 'HubSpot CRM', Icon: HubSpotIcon },
          ] as const).map(opt => {
            const isAvailable = availableCrms[opt.value]
            const isActive = currentCrm === opt.value
            const isPrimary = primaryCrm === opt.value
            const isSwitching = switchingCrm === opt.value
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => isAvailable && switchAgentCrm(opt.value)}
                disabled={!isAvailable || isSwitching || isActive}
                title={!isAvailable ? 'Connect this CRM from workspace Integrations first' : undefined}
                className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                  isAvailable ? 'hover:border-zinc-500' : 'opacity-50 cursor-not-allowed'
                } disabled:cursor-not-allowed`}
                style={
                  isActive
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                    : { borderColor: 'var(--border)', background: 'var(--surface)' }
                }
              >
                <div className="flex items-center gap-2 w-full">
                  {opt.Icon ? (
                    <opt.Icon className="w-5 h-5" />
                  ) : (
                    <div
                      className="w-5 h-5 rounded flex items-center justify-center text-xs"
                      style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                    >
                      📇
                    </div>
                  )}
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.label}</span>
                  {isActive && (
                    <span
                      className="ml-auto text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                    >
                      Active
                    </span>
                  )}
                </div>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.sub}</span>
                <div className="flex gap-1 mt-1">
                  {isPrimary && (
                    <span
                      className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}
                    >
                      Workspace default
                    </span>
                  )}
                  {!isAvailable && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Not connected
                    </span>
                  )}
                  {isSwitching && (
                    <span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>
                      Switching…
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>

        {crmBanner && (
          <p
            className={`text-xs mt-3 ${crmBanner.kind === 'success' ? '' : ''}`}
            style={{ color: crmBanner.kind === 'success' ? 'var(--accent-emerald)' : 'var(--accent-red)' }}
          >
            {crmBanner.text}
          </p>
        )}
      </div>

      <div className="flex gap-1 mb-6" style={{ borderBottom: '1px solid var(--border)' }}>
        <button
          onClick={() => setTab('connected')}
          className="px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
          style={
            tab === 'connected'
              ? { borderColor: 'var(--text-primary)', color: 'var(--text-primary)' }
              : { borderColor: 'transparent', color: 'var(--text-tertiary)' }
          }
        >Connected ({servers.length})</button>
        <button
          onClick={() => setTab('logs')}
          className="px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors"
          style={
            tab === 'logs'
              ? { borderColor: 'var(--text-primary)', color: 'var(--text-primary)' }
              : { borderColor: 'transparent', color: 'var(--text-tertiary)' }
          }
        >Logs</button>
      </div>

      {tab === 'connected' && (
        <ConnectedView
          servers={servers}
          attachments={attachments}
          workspaceId={workspaceId}
          agentId={agentId}
          onRefresh={refresh}
        />
      )}

      {tab === 'logs' && <LogsView workspaceId={workspaceId} agentId={agentId} />}

      {connectOpen && (
        <ConnectModal
          registry={registry}
          workspaceId={workspaceId}
          onClose={() => setConnectOpen(false)}
          onConnected={async () => { setConnectOpen(false); await refresh() }}
        />
      )}
    </div>
  )
}

function ConnectedView({
  servers, attachments, workspaceId, agentId, onRefresh,
}: {
  servers: McpServer[]
  attachments: Attachment[]
  workspaceId: string
  agentId: string
  onRefresh: () => Promise<void>
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const attMap = useMemo(() => {
    const m = new Map<string, Attachment>()
    for (const a of attachments) m.set(`${a.mcpServerId}:${a.toolName}`, a)
    return m
  }, [attachments])

  if (servers.length === 0) {
    return (
      <div
        className="text-center py-16 rounded-xl"
        style={{ border: '1px dashed var(--border)' }}
      >
        <div
          className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl"
          style={{ background: 'var(--surface-tertiary)' }}
        >🔌</div>
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No MCP servers connected yet</p>
        <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
          Connect Meta Ads, Stripe, Linear, or any custom MCP. Then write rules for when this agent should call them.
        </p>
      </div>
    )
  }

  const [discoverError, setDiscoverError] = useState<string | null>(null)
  async function discover(serverId: string) {
    setBusy(serverId)
    setDiscoverError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/mcp-servers/${serverId}/discover`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setDiscoverError(data.error || `Discovery failed (HTTP ${res.status})`)
        return
      }
      await onRefresh()
    } catch (err: any) {
      setDiscoverError(err?.message || 'Network error')
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      {discoverError && (
        <div
          className="p-3 rounded-lg text-xs"
          style={{ border: '1px solid var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {discoverError}
        </div>
      )}
      {servers.map(s => {
        const tools = s.discoveredTools || []
        return (
          <div
            key={s.id}
            className="rounded-xl overflow-hidden"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
          >
            <div className="p-5 flex items-start gap-4">
              {s.iconUrl ? (
                <img src={s.iconUrl} alt="" className="w-10 h-10 rounded-lg p-1.5 object-contain" style={{ background: 'var(--surface-tertiary)' }} />
              ) : (
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}
                >🔌</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-tertiary)' }}>{s.url}</p>
                {s.description && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{s.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                {!s.isActive && (
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: 'var(--text-tertiary)', background: 'var(--surface-tertiary)' }}
                  >paused</span>
                )}
                <button
                  onClick={() => discover(s.id)}
                  disabled={busy === s.id}
                  className="text-[11px] px-2.5 py-1.5 rounded transition-colors disabled:opacity-50 hover:opacity-80"
                  style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)', background: 'var(--surface-secondary)' }}
                >
                  {busy === s.id ? 'Discovering…' : tools.length > 0 ? 'Re-discover tools' : 'Discover tools'}
                </button>
              </div>
            </div>

            {tools.length === 0 ? (
              <div className="px-5 pb-5">
                <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  No tools discovered yet. Click &quot;Discover tools&quot; to fetch the tool list from the server.
                </p>
              </div>
            ) : (
              <div style={{ borderTop: '1px solid var(--border)' }}>
                {tools.map(t => {
                  const att = attMap.get(`${s.id}:${t.name}`)
                  return (
                    <ToolRow
                      key={t.name}
                      serverId={s.id}
                      tool={t}
                      attachment={att}
                      workspaceId={workspaceId}
                      agentId={agentId}
                      onChange={onRefresh}
                    />
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ToolRow({
  serverId, tool, attachment, workspaceId, agentId, onChange,
}: {
  serverId: string
  tool: DiscoveredTool
  attachment: Attachment | undefined
  workspaceId: string
  agentId: string
  onChange: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [enabled, setEnabled] = useState(attachment?.enabled ?? false)
  const [whenToUse, setWhenToUse] = useState(attachment?.whenToUse ?? '')
  const [keywordsText, setKeywordsText] = useState((attachment?.mustIncludeKeywords ?? []).join(', '))
  const [requireApproval, setRequireApproval] = useState(attachment?.requireApproval ?? false)
  const [saving, setSaving] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  // Sync local state when attachment from server changes
  useEffect(() => {
    setEnabled(attachment?.enabled ?? false)
    setWhenToUse(attachment?.whenToUse ?? '')
    setKeywordsText((attachment?.mustIncludeKeywords ?? []).join(', '))
    setRequireApproval(attachment?.requireApproval ?? false)
  }, [attachment])

  async function save(nextEnabled?: boolean) {
    setSaving(true)
    setRowError(null)
    try {
      const keywords = keywordsText.split(',').map(s => s.trim()).filter(Boolean)
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/mcp-tools`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mcpServerId: serverId,
          toolName: tool.name,
          enabled: nextEnabled ?? enabled,
          whenToUse: whenToUse.trim() || null,
          mustIncludeKeywords: keywords,
          requireApproval,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRowError(data.error || `Save failed (HTTP ${res.status})`)
        return
      }
      await onChange()
    } catch (err: any) {
      setRowError(err?.message || 'Network error')
    } finally { setSaving(false) }
  }

  async function toggleEnabled() {
    const next = !enabled
    setEnabled(next)
    await save(next)
  }

  async function detach() {
    if (!attachment) return
    if (!confirm(`Detach "${tool.name}" from this agent?`)) return
    setRowError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/mcp-tools?id=${attachment.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRowError(data.error || `Detach failed (HTTP ${res.status})`)
        return
      }
      await onChange()
    } catch (err: any) {
      setRowError(err?.message || 'Network error')
    }
  }

  return (
    <div
      className={`px-5 py-4 last:border-b-0 ${!enabled ? 'opacity-60' : ''}`}
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      {rowError && (
        <div
          className="mb-2 p-2 rounded text-[11px]"
          style={{ border: '1px solid var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
        >
          {rowError}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{tool.name}</code>
            {requireApproval && enabled && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ color: 'var(--accent-amber)', background: 'var(--accent-amber-bg)', boxShadow: 'inset 0 0 0 1px var(--accent-amber)' }}
              >
                approval required
              </span>
            )}
          </div>
          {tool.description && (
            <p className="text-[11px] line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{tool.description}</p>
          )}
          {enabled && whenToUse && (
            <p className="text-[11px] mt-1.5 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--text-tertiary)' }}>When to use: </span>{whenToUse}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleEnabled}
            className="relative inline-flex h-5 w-9 items-center rounded-full"
            style={{ background: enabled ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
            title={enabled ? 'Disable for this agent' : 'Enable for this agent'}
          >
            <span className="inline-block h-3 w-3 rounded-full transition-transform"
              style={{ background: '#fff', transform: enabled ? 'translateX(20px)' : 'translateX(4px)' }} />
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] px-2 py-1 transition-colors hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            {open ? 'Close' : 'Edit rule'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 space-y-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>When should the agent use this?</label>
            <textarea
              value={whenToUse}
              onChange={e => setWhenToUse(e.target.value)}
              rows={3}
              placeholder={`E.g. "When the contact asks about ad performance, ROAS, or wants to pause a campaign by name."`}
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Plain English. The agent reads this every turn and decides whether the situation matches.
            </p>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Required keywords (optional gate)</label>
            <input
              type="text"
              value={keywordsText}
              onChange={e => setKeywordsText(e.target.value)}
              placeholder="e.g. ads, campaign, roas, spend"
              className="w-full rounded px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
              Comma-separated. If set, the tool is hidden from the agent unless at least one keyword appears in the inbound message.
            </p>
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={e => setRequireApproval(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-orange-500"
            />
            <div>
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>Require human approval before calling</p>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                The agent will tell the contact it&apos;s checking with the team and stop. Useful for destructive actions.
              </p>
            </div>
          </label>

          <div className="flex items-center justify-between pt-2">
            {attachment ? (
              <button
                onClick={detach}
                className="text-[11px] transition-colors hover:opacity-80"
                style={{ color: 'var(--accent-red)' }}
              >Detach from this agent</button>
            ) : <span />}
            <button
              onClick={() => save()}
              disabled={saving}
              className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
              style={
                saving
                  ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }
                  : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
              }
            >
              {saving ? 'Saving…' : 'Save rule'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ConnectModal({
  registry, workspaceId, onClose, onConnected,
}: {
  registry: RegistryEntry[]
  workspaceId: string
  onClose: () => void
  onConnected: () => Promise<void>
}) {
  const [step, setStep] = useState<'pick' | 'configure'>('pick')
  const [picked, setPicked] = useState<RegistryEntry | null>(null)
  const [custom, setCustom] = useState(false)

  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'header' | 'none'>('bearer')
  const [authSecret, setAuthSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function pick(entry: RegistryEntry) {
    setPicked(entry)
    setCustom(false)
    setName(entry.name)
    setUrl(entry.defaultUrl)
    setAuthType(entry.authType)
    setStep('configure')
  }

  function pickCustom() {
    setPicked(null)
    setCustom(true)
    setName('')
    setUrl('')
    setAuthType('bearer')
    setStep('configure')
  }

  async function connect() {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/mcp-servers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrySlug: picked?.slug,
          name, url, authType,
          authSecret: authSecret || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Failed to connect')
        return
      }
      // Auto-discover after connect
      if (data.server?.id) {
        await fetch(`/api/workspaces/${workspaceId}/mcp-servers/${data.server.id}/discover`, { method: 'POST' }).catch(() => {})
      }
      await onConnected()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl shadow-2xl"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="p-6 flex items-start justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{step === 'pick' ? 'Connect an MCP server' : (custom ? 'Custom MCP server' : picked?.name)}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>
              {step === 'pick' ? 'Pick a curated integration or paste a custom URL.' : 'One-time setup — you\'ll attach individual tools to this agent next.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none hover:opacity-80"
            style={{ color: 'var(--text-tertiary)' }}
          >×</button>
        </div>

        {step === 'pick' && (
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {registry.map(r => (
                <button
                  key={r.slug}
                  onClick={() => pick(r)}
                  className="text-left p-4 rounded-xl transition-colors hover:opacity-90"
                  style={{ border: '1px solid var(--border)', background: 'var(--surface-secondary)' }}
                >
                  <div className="flex items-start gap-3">
                    <img src={r.iconUrl} alt="" className="w-8 h-8 rounded p-1 object-contain" style={{ background: 'var(--surface-tertiary)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{r.name}</p>
                      <p className="text-[11px] mt-0.5 line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{r.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={pickCustom}
              className="w-full text-left p-4 rounded-xl transition-colors hover:opacity-90"
              style={{ border: '1px dashed var(--border)', background: 'var(--surface-secondary)' }}
            >
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>+ Custom MCP server</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Paste any HTTP MCP URL. Best for self-hosted or beta integrations.</p>
            </button>
          </div>
        )}

        {step === 'configure' && (
          <div className="p-6 space-y-4">
            {error && (
              <div
                className="p-3 rounded-lg text-xs"
                style={{ border: '1px solid var(--accent-red)', background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
              >{error}</div>
            )}
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Display name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Meta Ads"
                className="w-full rounded px-3 py-2 text-sm"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>MCP server URL</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/v1"
                className="w-full rounded px-3 py-2 text-sm font-mono"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              />
            </div>
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Auth</label>
              <select
                value={authType}
                onChange={e => setAuthType(e.target.value as any)}
                className="w-full rounded px-3 py-2 text-sm mb-2"
                style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
              >
                <option value="bearer">Bearer token</option>
                <option value="header">Custom header (Header-Name: value)</option>
                <option value="none">No auth</option>
              </select>
              {authType !== 'none' && (
                <>
                  <input
                    type="password"
                    value={authSecret}
                    onChange={e => setAuthSecret(e.target.value)}
                    placeholder={authType === 'bearer' ? 'sk-…' : 'X-API-Key: secret'}
                    className="w-full rounded px-3 py-2 text-sm font-mono"
                    style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                  />
                  {picked?.authHelp && (
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {picked.authHelp}
                      {picked.authHelpUrl && (
                        <> — <a href={picked.authHelpUrl} target="_blank" rel="noopener" className="hover:underline" style={{ color: 'var(--accent-primary)' }}>where do I find it?</a></>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep('pick')}
                className="text-xs transition-colors hover:opacity-80"
                style={{ color: 'var(--text-tertiary)' }}
              >← Back</button>
              <button
                onClick={connect}
                disabled={saving || !name.trim() || !url.trim()}
                className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                style={
                  saving || !name.trim() || !url.trim()
                    ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }
                    : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
                }
              >
                {saving ? 'Connecting…' : 'Connect & discover tools'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface LogEntry {
  id: string
  createdAt: string
  contactName: string | null
  actionsPerformed: string[]
}

function LogsView({ workspaceId, agentId }: { workspaceId: string; agentId: string }) {
  const [logs, setLogs] = useState<LogEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/mcp-logs`)
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setLogs(d.logs || []) })
      .catch(e => setError(e.message))
  }, [workspaceId, agentId])

  if (error) return <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{error}</p>
  if (!logs) return <div className="h-6 w-32 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
  if (logs.length === 0) {
    return (
      <div
        className="text-center py-12 rounded-xl text-xs"
        style={{ border: '1px dashed var(--border)', color: 'var(--text-tertiary)' }}
      >
        No MCP tool calls yet. Once the agent fires a connected tool, the call shows up here.
      </div>
    )
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
    >
      <table className="w-full text-sm">
        <thead className="text-[11px] uppercase" style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}>
          <tr>
            <th className="text-left px-4 py-2 font-semibold">When</th>
            <th className="text-left px-4 py-2 font-semibold">Contact</th>
            <th className="text-left px-4 py-2 font-semibold">Tools called</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>{l.contactName || '—'}</td>
              <td className="px-4 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>
                {l.actionsPerformed.filter(a => a.startsWith('mcp:')).map(a => (
                  <span
                    key={a}
                    className="inline-block mr-2 mb-1 px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--surface-tertiary)' }}
                  >
                    {a.replace(/^mcp:/, '')}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
