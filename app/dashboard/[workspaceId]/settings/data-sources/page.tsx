'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type Kind = 'google_sheet' | 'airtable' | 'rest_get'

interface DataSource {
  id: string
  name: string
  kind: Kind
  description: string | null
  config: Record<string, any>
  isActive: boolean
  hasSecret: boolean
  createdAt: string
}

const KIND_LABELS: Record<Kind, string> = {
  google_sheet: 'Google Sheet',
  airtable: 'Airtable',
  rest_get: 'REST endpoint',
}

const KIND_ICONS: Record<Kind, string> = {
  google_sheet: '📊',
  airtable: '🗂',
  rest_get: '🌐',
}

export default function DataSourcesPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [sources, setSources] = useState<DataSource[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/data-sources`)
    const data = await res.json()
    if (data.notMigrated) {
      setError('Run prisma/migrations-legacy/manual_workspace_data_sources.sql in Supabase to enable this feature.')
      setSources([])
      return
    }
    if (!res.ok) {
      setError(data.error || 'Could not load data sources')
      return
    }
    setSources(data.sources || [])
    setError(null)
  }, [workspaceId])

  useEffect(() => { refresh() }, [refresh])

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Data sources</h1>
          <p className="text-sm mt-1 max-w-2xl" style={{ color: 'var(--text-secondary)' }}>
            Live handles your agents can query at runtime — Google Sheets, Airtable bases, or any REST endpoint.
            Pair them with the <code style={{ color: 'var(--accent-primary)' }}>lookup_sheet</code>, <code style={{ color: 'var(--accent-primary)' }}>query_airtable</code>, and <code style={{ color: 'var(--accent-primary)' }}>fetch_data</code> tools on each agent&apos;s Tools tab.
          </p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >+ New data source</button>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">{error}</div>
      )}

      {sources === null ? (
        <div className="h-6 w-32 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      ) : sources.length === 0 ? (
        <div className="text-center py-16 border border-dashed rounded-xl" style={{ borderColor: 'var(--border)' }}>
          <div className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl" style={{ background: 'var(--surface-tertiary)' }}>🔌</div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No data sources yet</p>
          <p className="text-xs max-w-sm mx-auto" style={{ color: 'var(--text-tertiary)' }}>
            Connect a sheet, base, or API and your agents can read live data instead of stale embedded copies.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map(s => (
            <SourceCard key={s.id} source={s} workspaceId={workspaceId} onChange={refresh} />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateModal
          workspaceId={workspaceId}
          onClose={() => setCreateOpen(false)}
          onCreated={async () => { setCreateOpen(false); await refresh() }}
        />
      )}
    </div>
  )
}

function SourceCard({ source, workspaceId, onChange }: { source: DataSource; workspaceId: string; onChange: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function remove() {
    if (!confirm(`Delete data source "${source.name}"?`)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/data-sources/${source.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || 'Delete failed')
        return
      }
      await onChange()
    } finally { setBusy(false) }
  }
  return (
    <div className="p-4 rounded-xl border" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <span className="text-2xl">{KIND_ICONS[source.kind]}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <code className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{source.name}</code>
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--surface-tertiary)' }}>{KIND_LABELS[source.kind]}</span>
              {source.hasSecret && (
                <span className="text-[10px] text-emerald-500 px-1.5 py-0.5 rounded bg-emerald-500/10">🔒 token saved</span>
              )}
            </div>
            {source.description && <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{source.description}</p>}
            <p className="text-[11px] mt-1 truncate" style={{ color: 'var(--text-tertiary)' }}>
              {source.kind === 'google_sheet' && source.config.url}
              {source.kind === 'airtable' && `${source.config.baseId} / ${source.config.tableName}`}
              {source.kind === 'rest_get' && source.config.url}
            </p>
          </div>
        </div>
        <button onClick={remove} disabled={busy}
          className="text-[11px] text-red-500 hover:text-red-600 transition-colors"
        >Delete</button>
      </div>
      {error && <p className="text-[11px] text-red-500 mt-2">{error}</p>}
    </div>
  )
}

function CreateModal({ workspaceId, onClose, onCreated }: {
  workspaceId: string
  onClose: () => void
  onCreated: () => Promise<void>
}) {
  const [kind, setKind] = useState<Kind>('google_sheet')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [airtableBaseId, setAirtableBaseId] = useState('')
  const [airtableTable, setAirtableTable] = useState('')
  const [airtableView, setAirtableView] = useState('')
  const [restUrl, setRestUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setSaving(true)
    setError(null)
    try {
      const config: Record<string, unknown> =
        kind === 'google_sheet' ? { url: sheetUrl }
        : kind === 'airtable' ? { baseId: airtableBaseId, tableName: airtableTable, view: airtableView || undefined }
        : { url: restUrl }
      const res = await fetch(`/api/workspaces/${workspaceId}/data-sources`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.toLowerCase().trim(),
          kind,
          description: description || null,
          config,
          secret: secret || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create data source')
        return
      }
      await onCreated()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl border shadow-2xl" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }} onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b flex items-start justify-between" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 className="text-base font-bold" style={{ color: 'var(--text-primary)' }}>Connect a data source</h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>Agents reference this by its name in tool calls.</p>
          </div>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-tertiary)' }}>×</button>
        </div>
        <div className="p-5 space-y-3">
          {error && <div className="p-2 rounded border border-red-500/30 bg-red-500/5 text-xs text-red-500">{error}</div>}
          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(['google_sheet', 'airtable', 'rest_get'] as Kind[]).map(k => (
                <button key={k} type="button"
                  onClick={() => setKind(k)}
                  className="p-3 rounded-lg border text-left transition-colors"
                  style={kind === k
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { borderColor: 'var(--border)' }}
                >
                  <div className="text-lg">{KIND_ICONS[k]}</div>
                  <div className="text-[11px] font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>{KIND_LABELS[k]}</div>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Name (used by the agent)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. inventory"
              className="w-full border rounded px-3 py-2 text-sm font-mono"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
            />
            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>Lowercase letters, numbers, dashes, underscores. 2–40 chars.</p>
          </div>

          <div>
            <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Description (helps the agent decide when to use this)</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="e.g. Live SKU inventory and prices"
              className="w-full border rounded px-3 py-2 text-sm"
              style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
            />
          </div>

          {kind === 'google_sheet' && (
            <div>
              <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Google Sheet URL</label>
              <input
                type="url"
                value={sheetUrl}
                onChange={e => setSheetUrl(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className="w-full border rounded px-3 py-2 text-sm"
                style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
              />
              <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                Share the sheet as &ldquo;Anyone with the link can view&rdquo;. We read it as CSV.
                Specific tab? Include the <code style={{ color: 'var(--accent-primary)' }}>#gid=…</code> from the URL.
              </p>
            </div>
          )}

          {kind === 'airtable' && (
            <>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Base ID (starts with app…)</label>
                <input
                  type="text"
                  value={airtableBaseId}
                  onChange={e => setAirtableBaseId(e.target.value)}
                  placeholder="app1234abcd"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Table name</label>
                <input
                  type="text"
                  value={airtableTable}
                  onChange={e => setAirtableTable(e.target.value)}
                  placeholder="Customers"
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>View (optional)</label>
                <input
                  type="text"
                  value={airtableView}
                  onChange={e => setAirtableView(e.target.value)}
                  placeholder="Active"
                  className="w-full border rounded px-3 py-2 text-sm"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Personal Access Token</label>
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="patXXXXXXXX.YYY"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Generate at <a href="https://airtable.com/create/tokens" target="_blank" rel="noopener" className="hover:underline" style={{ color: 'var(--accent-primary)' }}>airtable.com/create/tokens</a> with <code style={{ color: 'var(--accent-primary)' }}>data.records:read</code> scope on this base.
                </p>
              </div>
            </>
          )}

          {kind === 'rest_get' && (
            <>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>URL</label>
                <input
                  type="url"
                  value={restUrl}
                  onChange={e => setRestUrl(e.target.value)}
                  placeholder="https://api.example.com/status"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: 'var(--text-secondary)' }}>Bearer token (optional)</label>
                <input
                  type="password"
                  value={secret}
                  onChange={e => setSecret(e.target.value)}
                  placeholder="Leave blank for public endpoints"
                  className="w-full border rounded px-3 py-2 text-sm font-mono"
                  style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
                />
              </div>
            </>
          )}

          <div className="flex justify-end pt-2">
            <button
              onClick={create}
              disabled={saving || !name.trim()}
              className="text-xs font-semibold px-5 py-2 rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              {saving ? 'Connecting…' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
