'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

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

  const refresh = useCallback(async () => {
    try {
      const [serversRes, attRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/mcp-servers`).then(r => r.json()),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/mcp-tools`).then(r => r.json()),
      ])
      setServers(serversRes.servers || [])
      setRegistry(serversRes.registry || [])
      setAttachments(attRes.attachments || [])
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

  useEffect(() => { refresh() }, [refresh])

  if (loading) return <div className="p-8"><div className="h-6 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-white">Integrations</h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
            Connect external MCP servers and write plain-English rules for when this agent should use them.
            The agent will follow your &quot;when to use&quot; instructions exactly — keep them specific.
          </p>
        </div>
        <button
          onClick={() => setConnectOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors"
          style={{ background: '#fa4d2e' }}
        >
          + Connect MCP
        </button>
      </div>

      {pageError && (
        <div className="mb-4 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">
          {pageError}
        </div>
      )}

      <div className="flex gap-1 border-b border-zinc-800 mb-6">
        <button
          onClick={() => setTab('connected')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'connected' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
        >Connected ({servers.length})</button>
        <button
          onClick={() => setTab('logs')}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'logs' ? 'border-white text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
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
      <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">🔌</div>
        <p className="text-sm font-medium text-white mb-1">No MCP servers connected yet</p>
        <p className="text-xs text-zinc-500 max-w-sm mx-auto">
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
        <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">
          {discoverError}
        </div>
      )}
      {servers.map(s => {
        const tools = s.discoveredTools || []
        return (
          <div key={s.id} className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
            <div className="p-5 flex items-start gap-4">
              {s.iconUrl ? (
                <img src={s.iconUrl} alt="" className="w-10 h-10 rounded-lg bg-white/5 p-1.5 object-contain" />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-zinc-800 flex items-center justify-center text-zinc-400">🔌</div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-white">{s.name}</p>
                <p className="text-xs text-zinc-500 mt-0.5 truncate">{s.url}</p>
                {s.description && <p className="text-xs text-zinc-400 mt-1">{s.description}</p>}
              </div>
              <div className="flex items-center gap-2">
                {!s.isActive && <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800">paused</span>}
                <button
                  onClick={() => discover(s.id)}
                  disabled={busy === s.id}
                  className="text-[11px] px-2.5 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors disabled:opacity-50"
                >
                  {busy === s.id ? 'Discovering…' : tools.length > 0 ? 'Re-discover tools' : 'Discover tools'}
                </button>
              </div>
            </div>

            {tools.length === 0 ? (
              <div className="px-5 pb-5">
                <p className="text-xs text-zinc-500">
                  No tools discovered yet. Click &quot;Discover tools&quot; to fetch the tool list from the server.
                </p>
              </div>
            ) : (
              <div className="border-t border-zinc-800">
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
    <div className={`px-5 py-4 border-b border-zinc-800 last:border-b-0 ${!enabled ? 'opacity-60' : ''}`}>
      {rowError && (
        <div className="mb-2 p-2 rounded border border-red-500/30 bg-red-500/5 text-[11px] text-red-300">
          {rowError}
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <code className="text-sm text-white font-mono">{tool.name}</code>
            {requireApproval && enabled && (
              <span className="text-[10px] text-amber-300 px-1.5 py-0.5 rounded bg-amber-400/10 ring-1 ring-amber-400/20">
                approval required
              </span>
            )}
          </div>
          {tool.description && (
            <p className="text-[11px] text-zinc-500 line-clamp-2">{tool.description}</p>
          )}
          {enabled && whenToUse && (
            <p className="text-[11px] text-zinc-300 mt-1.5 line-clamp-2">
              <span className="text-zinc-500">When to use: </span>{whenToUse}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={toggleEnabled}
            className="relative inline-flex h-5 w-9 items-center rounded-full"
            style={{ background: enabled ? '#22c55e' : '#3f3f46' }}
            title={enabled ? 'Disable for this agent' : 'Enable for this agent'}
          >
            <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
              style={{ transform: enabled ? 'translateX(20px)' : 'translateX(4px)' }} />
          </button>
          <button
            onClick={() => setOpen(o => !o)}
            className="text-[11px] text-zinc-400 hover:text-white px-2 py-1 transition-colors"
          >
            {open ? 'Close' : 'Edit rule'}
          </button>
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-zinc-800 space-y-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">When should the agent use this?</label>
            <textarea
              value={whenToUse}
              onChange={e => setWhenToUse(e.target.value)}
              rows={3}
              placeholder={`E.g. "When the contact asks about ad performance, ROAS, or wants to pause a campaign by name."`}
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
              Plain English. The agent reads this every turn and decides whether the situation matches.
            </p>
          </div>

          <div>
            <label className="text-xs text-zinc-400 mb-1 block">Required keywords (optional gate)</label>
            <input
              type="text"
              value={keywordsText}
              onChange={e => setKeywordsText(e.target.value)}
              placeholder="e.g. ads, campaign, roas, spend"
              className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
            />
            <p className="text-[10px] text-zinc-500 mt-1">
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
              <p className="text-sm text-white">Require human approval before calling</p>
              <p className="text-xs text-zinc-500">
                The agent will tell the contact it&apos;s checking with the team and stop. Useful for destructive actions.
              </p>
            </div>
          </label>

          <div className="flex items-center justify-between pt-2">
            {attachment ? (
              <button
                onClick={detach}
                className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
              >Detach from this agent</button>
            ) : <span />}
            <button
              onClick={() => save()}
              disabled={saving}
              className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: '#fa4d2e' }}
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
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-950 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="p-6 border-b border-zinc-800 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">{step === 'pick' ? 'Connect an MCP server' : (custom ? 'Custom MCP server' : picked?.name)}</h2>
            <p className="text-xs text-zinc-500 mt-1">
              {step === 'pick' ? 'Pick a curated integration or paste a custom URL.' : 'One-time setup — you\'ll attach individual tools to this agent next.'}
            </p>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-white text-xl leading-none">×</button>
        </div>

        {step === 'pick' && (
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {registry.map(r => (
                <button
                  key={r.slug}
                  onClick={() => pick(r)}
                  className="text-left p-4 rounded-xl border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <img src={r.iconUrl} alt="" className="w-8 h-8 rounded bg-white/5 p-1 object-contain" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white">{r.name}</p>
                      <p className="text-[11px] text-zinc-500 mt-0.5 line-clamp-2">{r.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <button
              onClick={pickCustom}
              className="w-full text-left p-4 rounded-xl border border-dashed border-zinc-700 hover:border-zinc-500 hover:bg-zinc-900 transition-colors"
            >
              <p className="text-sm font-semibold text-white">+ Custom MCP server</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Paste any HTTP MCP URL. Best for self-hosted or beta integrations.</p>
            </button>
          </div>
        )}

        {step === 'configure' && (
          <div className="p-6 space-y-4">
            {error && (
              <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">{error}</div>
            )}
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Display name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Meta Ads"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">MCP server URL</label>
              <input
                type="url"
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/v1"
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white font-mono"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1 block">Auth</label>
              <select
                value={authType}
                onChange={e => setAuthType(e.target.value as any)}
                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white mb-2"
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
                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white font-mono"
                  />
                  {picked?.authHelp && (
                    <p className="text-[10px] text-zinc-500 mt-1">
                      {picked.authHelp}
                      {picked.authHelpUrl && (
                        <> — <a href={picked.authHelpUrl} target="_blank" rel="noopener" className="text-orange-400 hover:underline">where do I find it?</a></>
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center justify-between pt-2">
              <button
                onClick={() => setStep('pick')}
                className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
              >← Back</button>
              <button
                onClick={connect}
                disabled={saving || !name.trim() || !url.trim()}
                className="text-xs font-semibold px-4 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
                style={{ background: '#fa4d2e' }}
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

  if (error) return <p className="text-xs text-red-400">{error}</p>
  if (!logs) return <div className="h-6 w-32 bg-zinc-800 rounded animate-pulse" />
  if (logs.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl text-xs text-zinc-500">
        No MCP tool calls yet. Once the agent fires a connected tool, the call shows up here.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900 text-[11px] text-zinc-500 uppercase">
          <tr>
            <th className="text-left px-4 py-2 font-semibold">When</th>
            <th className="text-left px-4 py-2 font-semibold">Contact</th>
            <th className="text-left px-4 py-2 font-semibold">Tools called</th>
          </tr>
        </thead>
        <tbody>
          {logs.map(l => (
            <tr key={l.id} className="border-t border-zinc-800">
              <td className="px-4 py-3 text-xs text-zinc-400 whitespace-nowrap">
                {new Date(l.createdAt).toLocaleString()}
              </td>
              <td className="px-4 py-3 text-xs text-zinc-300">{l.contactName || '—'}</td>
              <td className="px-4 py-3 text-xs text-zinc-300 font-mono">
                {l.actionsPerformed.filter(a => a.startsWith('mcp:')).map(a => (
                  <span key={a} className="inline-block mr-2 mb-1 px-1.5 py-0.5 rounded bg-zinc-800">
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
