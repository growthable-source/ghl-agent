'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

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

  const load = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/collections`)
    const data = await res.json()
    setAvailable(data.available || [])
    const attachedIds = (data.attached || []).map((c: any) => c.id)
    setPicked(attachedIds)
    setOriginal(attachedIds)
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { load() }, [load])

  function toggle(id: string) {
    setPicked(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

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

  if (loading) return <div className="p-8 text-zinc-500 text-sm">Loading…</div>

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 flex items-start gap-3">
        <div className="w-8 h-8 rounded-lg bg-orange-500/15 text-orange-300 flex items-center justify-center flex-shrink-0">📚</div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Knowledge lives in Collections</p>
          <p className="text-xs text-zinc-400 mt-0.5">
            Pick which Collections this agent should pull from. To add or edit items —
            text, FAQs, file uploads, web crawls, Notion pages, YouTube transcripts, data sources —
            open the <Link href={`/dashboard/${workspaceId}/knowledge`} className="text-orange-300 hover:underline">workspace Knowledge page</Link>.
          </p>
        </div>
      </div>

      {notMigrated && (
        <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <p className="text-sm text-amber-300 font-semibold">Migration pending</p>
          <p className="text-xs text-amber-300/80 mt-1">
            Run <code className="bg-black/30 px-1 rounded">prisma/migrations/20260429160000_knowledge_collections/migration.sql</code> to enable Collections.
          </p>
        </div>
      )}

      {available.length === 0 ? (
        <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📚</div>
          <p className="text-sm font-medium text-white mb-1">No collections in this workspace</p>
          <p className="text-xs text-zinc-500 mb-4">Build a collection first, then come back to attach it.</p>
          <Link
            href={`/dashboard/${workspaceId}/knowledge`}
            className="inline-block text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
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
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  checked
                    ? 'border-orange-500/60 bg-orange-500/5'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                }`}
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
                  <p className="text-sm font-semibold text-white truncate">{c.name}</p>
                  {c.description && <p className="text-xs text-zinc-400 line-clamp-2 mt-0.5">{c.description}</p>}
                  <div className="flex items-center gap-2 mt-1.5 text-[10px] text-zinc-500 flex-wrap">
                    <span>{c.entryCount} item{c.entryCount === 1 ? '' : 's'}</span>
                    {c.dataSourceCount > 0 && <span>· {c.dataSourceCount} data source{c.dataSourceCount === 1 ? '' : 's'}</span>}
                  </div>
                </div>
                <Link
                  href={`/dashboard/${workspaceId}/knowledge/${c.id}`}
                  onClick={e => e.stopPropagation()}
                  className="text-[11px] text-zinc-500 hover:text-zinc-300 flex-shrink-0"
                >
                  Edit →
                </Link>
              </label>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-2">
        {savedAt && <span className="text-xs text-emerald-300">✓ Saved</span>}
        <button
          onClick={save}
          disabled={saving || !dirty}
          className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
        >
          {saving ? 'Saving…' : `Save (${picked.length} selected)`}
        </button>
      </div>
    </div>
  )
}
