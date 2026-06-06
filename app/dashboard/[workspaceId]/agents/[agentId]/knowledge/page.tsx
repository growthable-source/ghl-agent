'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import LiveDataSourcesPanel from '@/components/dashboard/LiveDataSourcesPanel'

interface CollectionLite {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  entryCount: number
  dataSourceCount: number
  isAttached?: boolean
}

interface KnowledgeDomainLite {
  id: string
  name: string
  description: string | null
  chunkCount: number
}

/**
 * The per-agent knowledge page is now a *connection picker*. Knowledge
 * itself lives in workspace-level Collections; agents pick which
 * collections to pull from. Multi-select. Save replaces the full set.
 *
 * Creation has moved entirely to the workspace Knowledge tab — see
 * /dashboard/[workspaceId]/knowledge/[collectionId] for the full
 * editor (write, upload, crawl, FAQ, Notion, YouTube, data sources).
 */
export default function AgentKnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [available, setAvailable] = useState<CollectionLite[]>([])
  const [original, setOriginal] = useState<string[]>([])
  const [picked, setPicked] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [notMigrated, setNotMigrated] = useState(false)

  // Phase 2 knowledge-domain scope. Operators pick which crawled/
  // indexed sources this agent reads from. Empty array = all
  // domains in the workspace (backward-compatible default).
  const [domains, setDomains] = useState<KnowledgeDomainLite[]>([])
  const [domainPick, setDomainPick] = useState<string[]>([])
  const [domainOriginal, setDomainOriginal] = useState<string[]>([])
  const [domainSavedAt, setDomainSavedAt] = useState<number | null>(null)
  const [domainSaving, setDomainSaving] = useState(false)

  const load = useCallback(async () => {
    const [colRes, domRes, agentRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/collections`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()).catch(() => ({})),
    ])

    setAvailable(colRes.available || [])
    const attachedIds = (colRes.attached || []).map((c: any) => c.id)
    setPicked(attachedIds)
    setOriginal(attachedIds)
    setNotMigrated(!!colRes.notMigrated)

    setDomains(domRes.domains || [])
    const agentDomains: string[] = agentRes.agent?.knowledgeDomainIds ?? []
    setDomainPick(agentDomains)
    setDomainOriginal(agentDomains)

    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleDomain(id: string) {
    setDomainPick(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function saveDomainScope(allDomains: boolean) {
    setDomainSaving(true)
    try {
      // "all domains" sends an empty array (= no filter, backward
      // compatible). Otherwise sends the explicit list.
      const ids = allDomains ? [] : domainPick
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ knowledgeDomainIds: ids }),
      })
      setDomainOriginal(ids)
      setDomainPick(ids)
      setDomainSavedAt(Date.now())
      setTimeout(() => setDomainSavedAt(null), 2000)
    } finally { setDomainSaving(false) }
  }

  const domainDirty = domainPick.length !== domainOriginal.length
    || domainPick.some(id => !domainOriginal.includes(id))
  const usingAllDomains = domainOriginal.length === 0

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/collections`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collectionIds: picked }),
      })
      setOriginal(picked)
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2000)
    } finally { setSaving(false) }
  }

  const dirty = picked.length !== original.length || picked.some(id => !original.includes(id))

  if (loading) return <div className="p-8 text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</div>

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div
        className="rounded-xl p-4 flex items-start gap-3"
        style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
      >
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
        >📚</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Knowledge lives in Collections</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Pick which Collections this agent should pull from. To add or edit items —
            text, FAQs, file uploads, web crawls, Notion pages, YouTube transcripts, data sources —
            open the <Link href={`/dashboard/${workspaceId}/knowledge`} className="hover:underline" style={{ color: 'var(--accent-primary)' }}>workspace Knowledge page</Link>.
          </p>
        </div>
      </div>

      {/* Live data sources — Shopify (and any future integrations). Agents
          access these via tool calls during a conversation, not via
          indexed text. The connection lives at workspace level and applies
          to every agent in that workspace, so this is a status panel +
          one-click connect/disconnect, not a per-agent attach toggle. */}
      <LiveDataSourcesPanel workspaceId={workspaceId} />

      {/* Phase 2 knowledge-domain scope — pick which indexed knowledge
          collections this agent reads from. */}
      {domains.length > 0 && (
        <div
          className="rounded-xl p-5"
          style={{ border: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Indexed knowledge collections
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                Pick which crawled / uploaded collections this agent uses to answer questions. By default it reads from all of them.
              </p>
            </div>
            {usingAllDomains && (
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded"
                style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                Reading all
              </span>
            )}
          </div>

          <div className="space-y-2">
            {domains.map(d => {
              const checked = usingAllDomains || domainPick.includes(d.id)
              const effectivelyAll = usingAllDomains
              return (
                <label
                  key={d.id}
                  className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                  style={
                    checked && !effectivelyAll
                      ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                      : { border: '1px solid var(--border)', background: 'var(--surface-secondary)' }
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      if (effectivelyAll) {
                        // Operator wants to narrow — seed pick with all
                        // current domains minus the one they just clicked.
                        setDomainPick(domains.filter(x => x.id !== d.id).map(x => x.id))
                      } else {
                        toggleDomain(d.id)
                      }
                    }}
                    className="mt-0.5 accent-orange-500"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{d.name}</p>
                    {d.description && (
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                        {d.description}
                      </p>
                    )}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                      {d.chunkCount} indexed entries
                    </p>
                  </div>
                </label>
              )
            })}
          </div>

          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => saveDomainScope(true)}
              disabled={domainSaving || usingAllDomains}
              className="text-[11px] disabled:opacity-50"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Reset to all
            </button>
            <div className="flex items-center gap-2">
              {domainSavedAt && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>✓ Saved</span>}
              <button
                onClick={() => saveDomainScope(false)}
                disabled={domainSaving || !domainDirty}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
              >
                {domainSaving ? 'Saving…' : 'Save scope'}
              </button>
            </div>
          </div>
        </div>
      )}

      {notMigrated && (
        <div
          className="p-4 rounded-xl"
          style={{ border: '1px solid var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
        >
          <p className="text-sm font-semibold" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
          <p className="text-xs mt-1" style={{ color: 'var(--accent-amber)' }}>
            Run <code className="px-1 rounded" style={{ background: 'var(--surface-tertiary)' }}>prisma/migrations/20260429160000_knowledge_collections/migration.sql</code> to enable Collections.
          </p>
        </div>
      )}

      {available.length === 0 ? (
        <div
          className="text-center py-12 rounded-xl"
          style={{ border: '1px dashed var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center text-2xl"
            style={{ background: 'var(--surface-tertiary)' }}
          >📚</div>
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No collections in this workspace</p>
          <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>Build a collection first, then come back to attach it.</p>
          <Link
            href={`/dashboard/${workspaceId}/knowledge`}
            className="inline-block text-xs font-semibold px-3 py-1.5 rounded-lg hover:opacity-90"
            style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
          >
            Open Knowledge
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {available.map(c => {
            const checked = picked.includes(c.id)
            const accent = c.color || '#fa4d2e'
            return (
              <label
                key={c.id}
                className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors"
                style={
                  checked
                    ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { border: '1px solid var(--border)', background: 'var(--surface)' }
                }
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
                  className="mt-1 accent-orange-500"
                />
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center text-base flex-shrink-0"
                  style={{ background: `linear-gradient(135deg, ${accent}33, ${accent}11)` }}
                >
                  {c.icon || '📚'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                  {c.description && <p className="text-xs line-clamp-2 mt-0.5" style={{ color: 'var(--text-secondary)' }}>{c.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] flex-wrap" style={{ color: 'var(--text-tertiary)' }}>
                    <span>{c.entryCount} item{c.entryCount === 1 ? '' : 's'}</span>
                    {c.dataSourceCount > 0 && <span>· {c.dataSourceCount} data source{c.dataSourceCount === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <Link
                  href={`/dashboard/${workspaceId}/knowledge/${c.id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-[11px] flex-shrink-0 hover:opacity-80"
                  style={{ color: 'var(--text-tertiary)' }}
                >
                  Edit →
                </Link>
              </label>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {savedAt && <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>✓ Saved</span>}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          style={
            saving || !dirty
              ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }
              : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
          }
        >
          {saving ? 'Saving…' : `Save (${picked.length} selected)`}
        </button>
      </div>
    </div>
  )
}
