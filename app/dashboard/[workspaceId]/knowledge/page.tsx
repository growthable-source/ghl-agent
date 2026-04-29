'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Collection {
  id: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  order: number
  entryCount: number
  dataSourceCount: number
  agentCount: number
  createdAt: string
  updatedAt: string
}

const PRESET_ICONS = ['📚', '📦', '💼', '🛠️', '📞', '🛒', '🎯', '🔬', '📊', '🧭', '🧰', '💡']
const PRESET_COLORS = ['#fa4d2e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function WorkspaceKnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [collections, setCollections] = useState<Collection[]>([])
  const [brands, setBrands] = useState<Array<{ id: string; name: string; primaryColor: string | null }>>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [search, setSearch] = useState('')
  const [creator, setCreator] = useState(false)

  const fetchAll = useCallback(async () => {
    const [cRes, bRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/knowledge/collections`),
      fetch(`/api/workspaces/${workspaceId}/brands`),
    ])
    const data = await cRes.json()
    const bData = await bRes.json()
    setCollections(data.collections || [])
    setBrands((bData.brands || []).map((b: any) => ({ id: b.id, name: b.name, primaryColor: b.primaryColor })))
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = useMemo(() => {
    if (!search.trim()) return collections
    const q = search.toLowerCase().trim()
    return collections.filter(c =>
      c.name.toLowerCase().includes(q)
      || (c.description || '').toLowerCase().includes(q),
    )
  }, [collections, search])

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-32 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Knowledge</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Build named Collections — bundles of FAQs, files, web pages, Notion docs, YouTube transcripts, and live data sources.
              Stack collections onto agents to give them context.
            </p>
          </div>
          <button
            onClick={() => setCreator(true)}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors"
          >
            + New collection
          </button>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-semibold">Migration pending</p>
            <p className="text-xs text-amber-300/80 mt-1">
              Run <code className="bg-black/30 px-1 rounded">prisma/migrations/20260429160000_knowledge_collections/migration.sql</code> to switch to the Collections model.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search collections…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="ml-auto text-[11px] text-zinc-500">
            {filtered.length} of {collections.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📚</div>
            <p className="text-sm font-medium text-white mb-1">
              {search.trim() ? 'No matches' : 'No collections yet'}
            </p>
            <p className="text-xs text-zinc-500">
              {search.trim()
                ? 'Try a different search.'
                : 'Build your first collection — group everything an agent needs to know about a topic, then connect it to one or more agents.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(c => {
              const accent = c.color || '#fa4d2e'
              const icon = c.icon || '📚'
              return (
                <Link
                  key={c.id}
                  href={`/dashboard/${workspaceId}/knowledge/${c.id}`}
                  className="block p-4 rounded-xl border border-zinc-800 bg-zinc-950 hover:border-zinc-600 transition-colors"
                >
                  <div className="flex items-start gap-3 mb-2">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center text-lg flex-shrink-0"
                      style={{ background: `linear-gradient(135deg, ${accent}33, ${accent}11)` }}
                    >
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                      {c.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 mt-0.5">{c.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-3 text-[10px] text-zinc-500 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {c.entryCount} item{c.entryCount === 1 ? '' : 's'}
                    </span>
                    {c.dataSourceCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                        {c.dataSourceCount} data source{c.dataSourceCount === 1 ? '' : 's'}
                      </span>
                    )}
                    {c.agentCount > 0 ? (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                        on {c.agentCount} agent{c.agentCount === 1 ? '' : 's'}
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded border border-dashed border-zinc-700 text-zinc-500">
                        not connected
                      </span>
                    )}
                    <span className="ml-auto">updated {relTime(c.updatedAt)}</span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>

      {creator && (
        <CreateCollectionModal
          workspaceId={workspaceId}
          brands={brands}
          onClose={() => setCreator(false)}
          onCreated={() => { setCreator(false); fetchAll() }}
        />
      )}
    </div>
  )
}

function CreateCollectionModal({
  workspaceId, brands, onClose, onCreated,
}: {
  workspaceId: string
  brands: Array<{ id: string; name: string; primaryColor: string | null }>
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [icon, setIcon] = useState(PRESET_ICONS[0])
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [brandId, setBrandId] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          icon,
          color,
          brandId: brandId || null,
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Create failed'); return
      }
      onCreated()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">New collection</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Name</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Master FAQs"
              maxLength={80}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this collection cover?"
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Icon</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_ICONS.map(i => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIcon(i)}
                  className={`w-9 h-9 rounded-lg text-base flex items-center justify-center border transition-colors ${
                    icon === i ? 'border-orange-500 bg-orange-500/10' : 'border-zinc-700 bg-zinc-900 hover:border-zinc-500'
                  }`}
                >{i}</button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Accent color</label>
            <div className="flex flex-wrap gap-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-9 h-9 rounded-lg border-2 transition-colors ${color === c ? 'border-white' : 'border-transparent'}`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          {brands.length > 0 && (
            <div>
              <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
                Brand
                <span className="ml-2 normal-case font-normal text-zinc-600">leave blank for "shared across every brand"</span>
              </label>
              <select
                value={brandId}
                onChange={e => setBrandId(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
              >
                <option value="">— No brand (shared) —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}
