'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

/**
 * Landing page for a knowledge collection share link.
 *
 * The sharer sends /knowledge-share/<code>. The recipient signs in,
 * sees what they'd be importing, picks which of their workspaces
 * receives the copy, and lands in the new collection.
 */

interface Preview {
  share: { code: string; note: string | null; expiresAt: string | null; usesRemaining: number | null }
  collection: {
    name: string
    description: string | null
    icon: string | null
    color: string | null
    entryCount: number
    tokenEstimate: number
    sampleTitles: string[]
    skippedDataSourceCount: number
    sharedByWorkspaceName: string
  }
  workspaces: Array<{ id: string; name: string; icon: string | null; role: string }>
}

export default function KnowledgeSharePage() {
  const params = useParams()
  const router = useRouter()
  const code = params.code as string

  const [preview, setPreview] = useState<Preview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [needsSignIn, setNeedsSignIn] = useState(false)

  const [targetId, setTargetId] = useState('')
  const [name, setName] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/knowledge-shares/${encodeURIComponent(code)}`)
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) { setNeedsSignIn(true); setLoading(false); return }
    if (!res.ok) { setLoadError(data.error || 'That share link is not valid.'); setLoading(false); return }
    setPreview(data)
    setName(data.collection.name)
    if (data.workspaces.length === 1) setTargetId(data.workspaces[0].id)
    setLoading(false)
  }, [code])

  useEffect(() => { load() }, [load])

  async function doImport() {
    setError(null)
    if (!targetId) { setError('Pick a workspace to import into.'); return }
    setImporting(true)
    try {
      const res = await fetch(`/api/knowledge-shares/${encodeURIComponent(code)}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetWorkspaceId: targetId, name: name.trim() || null }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'Import failed'); return }
      router.push(`/dashboard/${data.workspaceId}/knowledge/${data.imported.collectionId}`)
    } finally { setImporting(false) }
  }

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: 'var(--surface-primary)' }}>
      <div className="w-full max-w-lg rounded-2xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}>
        {children}
      </div>
    </div>
  )

  if (loading) return shell(
    <div className="space-y-3">
      <div className="h-6 w-56 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
      <div className="h-24 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
    </div>
  )

  if (needsSignIn) return shell(
    <div className="text-center">
      <div className="text-3xl mb-2">🔐</div>
      <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Sign in to view this collection</h1>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
        Someone shared a knowledge collection with you. Sign in and we’ll bring you straight back here.
      </p>
      <a
        href={`/login?callbackUrl=${encodeURIComponent(`/knowledge-share/${code}`)}`}
        className="inline-block mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
        style={{ background: 'var(--accent-primary)', color: '#fff' }}
      >
        Sign in
      </a>
    </div>
  )

  if (loadError || !preview) return shell(
    <div className="text-center">
      <div className="text-3xl mb-2">🔗</div>
      <h1 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Link unavailable</h1>
      <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>{loadError}</p>
    </div>
  )

  const c = preview.collection
  const accent = c.color || '#fa4d2e'

  return shell(
    <div>
      <div className="flex items-start gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: `linear-gradient(135deg, ${accent}33, ${accent}11)` }}
        >
          {c.icon || '📚'}
        </div>
        <div className="min-w-0">
          <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
            {c.sharedByWorkspaceName} shared a knowledge collection with you
          </p>
          <h1 className="text-lg font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{c.name}</h1>
          {c.description && <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{c.description}</p>}
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
            {c.entryCount} item{c.entryCount === 1 ? '' : 's'}
            {c.tokenEstimate > 0 && <> · ~{c.tokenEstimate.toLocaleString()} tokens</>}
          </p>
        </div>
      </div>

      {c.sampleTitles.length > 0 && (
        <div className="mb-4 p-3 rounded-lg" style={{ background: 'var(--surface-tertiary)' }}>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
            What’s inside
          </p>
          <ul className="space-y-0.5">
            {c.sampleTitles.map((t, i) => (
              <li key={i} className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>· {t}</li>
            ))}
            {c.entryCount > c.sampleTitles.length && (
              <li className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                + {c.entryCount - c.sampleTitles.length} more
              </li>
            )}
          </ul>
        </div>
      )}

      {c.skippedDataSourceCount > 0 && (
        <p className="text-[11px] mb-4" style={{ color: 'var(--text-tertiary)' }}>
          {c.skippedDataSourceCount} live data source{c.skippedDataSourceCount === 1 ? '' : 's'} on the original
          won’t come across — those hold credentials, so you’ll connect your own.
        </p>
      )}

      {preview.workspaces.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
          You don’t have a workspace you can write to. Create one first, then open this link again.
        </p>
      ) : (
        <>
          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Import into
          </label>
          <select
            value={targetId}
            onChange={e => setTargetId(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 mb-3"
          >
            <option value="">— Choose a workspace —</option>
            {preview.workspaces.map(w => (
              <option key={w.id} value={w.id}>{w.icon ? `${w.icon} ` : ''}{w.name}</option>
            ))}
          </select>

          <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
            Name it
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            maxLength={80}
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
          />

          {error && <p className="text-xs text-red-400 mt-3">{error}</p>}

          <button
            onClick={doImport}
            disabled={importing || !targetId}
            className="w-full mt-4 px-4 py-2 rounded-lg text-sm font-semibold"
            style={(importing || !targetId)
              ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
              : { background: 'var(--accent-primary)', color: '#fff' }}
          >
            {importing ? 'Importing…' : 'Import collection'}
          </button>
          <p className="text-[10px] text-center mt-2" style={{ color: 'var(--text-tertiary)' }}>
            You get your own copy — later changes on either side stay independent.
          </p>
        </>
      )}
    </div>
  )
}
