'use client'

import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Brand {
  id: string
  name: string
  slug: string
  description: string | null
  logoUrl: string | null
  primaryColor: string | null
  widgetCount: number
  collectionCount: number
  createdAt: string
  updatedAt: string
}

const PRESET_COLORS = ['#fa4d2e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b']

export default function BrandsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [brands, setBrands] = useState<Brand[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [search, setSearch] = useState('')
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; brand?: Brand } | null>(null)

  const fetchAll = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/brands`)
    const data = await res.json()
    setBrands(data.brands || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = useMemo(() => {
    if (!search.trim()) return brands
    const q = search.toLowerCase().trim()
    return brands.filter(b =>
      b.name.toLowerCase().includes(q)
      || b.slug.toLowerCase().includes(q)
      || (b.description || '').toLowerCase().includes(q),
    )
  }, [brands, search])

  async function handleDelete(id: string) {
    if (!confirm('Delete this brand? Widgets and collections currently tagged to it will become untagged.')) return
    await fetch(`/api/workspaces/${workspaceId}/brands/${id}`, { method: 'DELETE' })
    fetchAll()
  }

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
            <h1 className="text-2xl font-bold text-white">Brands</h1>
          </div>
          <button
            onClick={() => setEditor({ mode: 'create' })}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors"
          >
            + New brand
          </button>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-semibold">Migration pending</p>
            <p className="text-xs text-amber-300/80 mt-1">
              Run <code className="bg-black/30 px-1 rounded">prisma/migrations/20260429180000_brands/migration.sql</code> to enable Brands.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search brands…"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <div className="ml-auto text-[11px] text-zinc-500">
            {filtered.length} of {brands.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">🏷️</div>
            <p className="text-sm font-medium text-white mb-1">
              {search.trim() ? 'No matches' : 'No brands yet'}
            </p>
            <p className="text-xs text-zinc-500">
              {search.trim()
                ? 'Try a different search.'
                : 'Add a brand for each whitelabel client. Tag widgets and collections to it; the inbox and exports will filter automatically.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {filtered.map(b => {
              const accent = b.primaryColor || '#fa4d2e'
              return (
                <div key={b.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-950">
                  <div className="flex items-start gap-3 mb-3">
                    {b.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover bg-zinc-900 flex-shrink-0" />
                    ) : (
                      <div
                        className="w-10 h-10 rounded-lg flex items-center justify-center text-base font-bold text-white flex-shrink-0"
                        style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
                      >
                        {b.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{b.name}</p>
                      <p className="text-[11px] text-zinc-500 font-mono truncate">{b.slug}</p>
                      {b.description && (
                        <p className="text-xs text-zinc-400 line-clamp-2 mt-1">{b.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-zinc-500 flex-wrap">
                    <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {b.widgetCount} widget{b.widgetCount === 1 ? '' : 's'}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                      {b.collectionCount} collection{b.collectionCount === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-zinc-800">
                    <button
                      onClick={() => setEditor({ mode: 'edit', brand: b })}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      Edit
                    </button>
                    <Link
                      href={`/dashboard/${workspaceId}/inbox?brand=${b.slug}`}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      Inbox →
                    </Link>
                    <a
                      href={`/api/workspaces/${workspaceId}/brands/${b.id}/transcripts/export?format=json`}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                      title="Download a JSON export of every conversation tagged to this brand"
                    >
                      Export ↓
                    </a>
                    <button
                      onClick={() => handleDelete(b.id)}
                      className="ml-auto text-[11px] px-2.5 py-1 rounded-lg border border-zinc-800 text-red-400 hover:text-red-300 hover:border-red-500/40 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {editor && (
        <BrandEditorModal
          workspaceId={workspaceId}
          mode={editor.mode}
          brand={editor.brand}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); fetchAll() }}
        />
      )}
    </div>
  )
}

function BrandEditorModal({
  workspaceId, mode, brand, onClose, onSaved,
}: {
  workspaceId: string
  mode: 'create' | 'edit'
  brand?: Brand
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(brand?.name ?? '')
  const [slug, setSlug] = useState(brand?.slug ?? '')
  const [description, setDescription] = useState(brand?.description ?? '')
  const [logoUrl, setLogoUrl] = useState(brand?.logoUrl ?? '')
  const [color, setColor] = useState(brand?.primaryColor ?? PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [slugTouched, setSlugTouched] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  // Vision-suggested colours after a logo upload. Rendered as extra
  // swatches alongside the preset palette with a "Suggested" label.
  const [suggestedColors, setSuggestedColors] = useState<string[]>([])
  const [styleHint, setStyleHint] = useState<string | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Auto-derive slug from name on the create flow until the user types
  // their own. On edit, leave whatever the user has set.
  function onNameChange(v: string) {
    setName(v)
    if (mode === 'create' && !slugTouched) {
      setSlug(v.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, ''))
    }
  }

  // After a logo lands, kick off vision analysis. Failures are
  // non-fatal — the brand still saves with the manually-picked colour.
  async function analyzeLogo(url: string) {
    setAnalyzing(true)
    setStyleHint(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/brands/analyze-logo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageUrl: url }),
      })
      if (!res.ok) return
      const d = await res.json()
      const colours: string[] = []
      if (d.primaryColor) colours.push(d.primaryColor)
      if (Array.isArray(d.accentColors)) {
        for (const c of d.accentColors) if (typeof c === 'string' && !colours.includes(c)) colours.push(c)
      }
      setSuggestedColors(colours)
      if (d.style) setStyleHint(d.style)
      // First-touch convenience: auto-select the suggested primary
      // colour, but only if the user is still on the default preset
      // (i.e. they haven't picked something deliberate yet). Avoids
      // overriding a deliberate choice on re-upload.
      if (d.primaryColor && color === PRESET_COLORS[0]) setColor(d.primaryColor)
      // Auto-fill suggested name only on create flow + only if the
      // user hasn't typed anything meaningful yet.
      if (mode === 'create' && d.suggestedName && !name.trim()) {
        onNameChange(d.suggestedName)
      }
    } catch {
      /* swallow — vision is best-effort */
    } finally { setAnalyzing(false) }
  }

  async function uploadLogo(file: File) {
    setUploadError(null)
    setUploading(true)
    setSuggestedColors([])
    setStyleHint(null)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/workspaces/${workspaceId}/brands/upload-logo`, {
        method: 'POST',
        body: form,
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUploadError(d.error || 'Upload failed')
        return
      }
      setLogoUrl(d.logoUrl)
      // Kick off vision in the background — don't block the form.
      void analyzeLogo(d.logoUrl)
    } finally { setUploading(false) }
  }

  async function save() {
    setError(null)
    if (!name.trim()) { setError('Name is required.'); return }
    setSaving(true)
    try {
      const body = {
        name: name.trim(),
        slug: slug.trim() || undefined,
        description: description.trim() || null,
        logoUrl: logoUrl.trim() || null,
        primaryColor: color,
      }
      const url = mode === 'create'
        ? `/api/workspaces/${workspaceId}/brands`
        : `/api/workspaces/${workspaceId}/brands/${brand!.id}`
      const method = mode === 'create' ? 'POST' : 'PATCH'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error || 'Save failed'); return
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">{mode === 'create' ? 'New brand' : 'Edit brand'}</h2>
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
              onChange={e => onNameChange(e.target.value)}
              placeholder="Acme Corp"
              maxLength={80}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
              Slug
              <span className="ml-2 normal-case font-normal text-zinc-600">used in export filenames + the brand-scoped inbox URL</span>
            </label>
            <input
              value={slug}
              onChange={e => { setSlug(e.target.value.toLowerCase()); setSlugTouched(true) }}
              placeholder="acme-corp"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Description (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="What does this brand do?"
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
              Logo
              <span className="ml-2 normal-case font-normal text-zinc-600">PNG, JPG, SVG · max 2 MB</span>
            </label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
              hidden
              onChange={e => { const f = e.target.files?.[0]; if (f) void uploadLogo(f); if (e.target) e.target.value = '' }}
            />
            {logoUrl ? (
              <div className="flex items-start gap-3 p-3 rounded-lg bg-zinc-900 border border-zinc-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoUrl} alt="" className="w-14 h-14 rounded-lg object-cover bg-zinc-950 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-zinc-300 break-all">{logoUrl}</p>
                  {analyzing && (
                    <p className="text-[10px] text-zinc-500 mt-1 inline-flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                      Analyzing colours…
                    </p>
                  )}
                  {styleHint && !analyzing && (
                    <p className="text-[10px] text-zinc-500 mt-1">Style: {styleHint}</p>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploading}
                      className="text-[10px] px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-50"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => { setLogoUrl(''); setSuggestedColors([]); setStyleHint(null) }}
                      className="text-[10px] px-2 py-1 rounded border border-zinc-800 text-red-400 hover:text-red-300 hover:border-red-500/40"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="w-full p-6 rounded-lg border-2 border-dashed border-zinc-700 hover:border-zinc-500 transition-colors text-center disabled:opacity-50"
              >
                <p className="text-sm text-zinc-300">{uploading ? 'Uploading…' : '📤  Upload logo'}</p>
                <p className="text-[10px] text-zinc-500 mt-1">We'll suggest accent colours from the image</p>
              </button>
            )}
            {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
          </div>

          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Accent color</label>

            {/* Vision-suggested swatches first when present, with a label
                so the user knows where they came from. */}
            {suggestedColors.length > 0 && (
              <div className="mb-2">
                <p className="text-[10px] text-orange-300 mb-1.5">✨ Suggested from your logo</p>
                <div className="flex flex-wrap gap-1.5">
                  {suggestedColors.map(c => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      title={c}
                      className={`w-9 h-9 rounded-lg border-2 transition-colors ${color === c ? 'border-white' : 'border-orange-500/40'}`}
                      style={{ background: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            )}

            <p className={`text-[10px] text-zinc-500 ${suggestedColors.length > 0 ? 'mb-1.5' : 'hidden'}`}>
              Or pick a preset
            </p>
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
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:text-white">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
