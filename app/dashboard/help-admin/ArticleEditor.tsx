'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Markdown } from '@/lib/help-markdown'

interface Category { id: string; name: string }

interface ArticleDraft {
  slug?: string
  title: string
  summary: string
  body: string
  videoUrl: string
  categoryId: string
  status: 'draft' | 'published'
  order: number
}

/**
 * Client-side editor for help articles — used for both new and existing.
 * Splits into form + markdown preview, toggle between them on mobile.
 *
 * When the article already exists, `existingSlug` is passed so we PATCH
 * rather than POST. On create we navigate to the edit page of the new
 * article so further tweaks stay on the same URL.
 */
export default function ArticleEditor({
  initial,
  categories,
  existingSlug,
}: {
  initial: ArticleDraft
  categories: Category[]
  existingSlug?: string
}) {
  const router = useRouter()
  const [draft, setDraft] = useState<ArticleDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')

  function set<K extends keyof ArticleDraft>(key: K, value: ArticleDraft[K]) {
    setDraft(d => ({ ...d, [key]: value }))
  }

  async function save(asStatus?: 'draft' | 'published') {
    setSaving(true)
    setError(null)
    const payload = {
      ...draft,
      status: asStatus ?? draft.status,
      categoryId: draft.categoryId || null,
    }
    try {
      const url = existingSlug
        ? `/api/help/articles/${existingSlug}`
        : '/api/help/articles'
      const res = await fetch(url, {
        method: existingSlug ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Save failed (${res.status})`)
      }
      const { article } = await res.json()
      if (!existingSlug) {
        // Jump to the slug-based edit page so subsequent saves PATCH.
        router.push(`/dashboard/help-admin/articles/${article.slug}`)
      } else {
        // Keep the local status in sync (publishedAt may have changed etc.)
        setDraft(d => ({ ...d, status: article.status }))
        router.refresh()
      }
    } catch (err: any) {
      setError(err?.message ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function deleteArticle() {
    if (!existingSlug) return
    if (!confirm(`Delete "${draft.title}" permanently? This can't be undone.`)) return
    const res = await fetch(`/api/help/articles/${existingSlug}`, { method: 'DELETE' })
    if (res.ok) router.push('/dashboard/help-admin')
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Form ── */}
        <div className="space-y-4">
          <Field label="Title">
            <input
              type="text"
              value={draft.title}
              onChange={e => set('title', e.target.value)}
              placeholder="How to connect GoHighLevel"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </Field>

          <Field label="Summary" hint="One-sentence description shown in listings and search results.">
            <textarea
              value={draft.summary}
              onChange={e => set('summary', e.target.value)}
              rows={2}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500 resize-none"
            />
          </Field>

          <Field label="Category">
            <select
              value={draft.categoryId}
              onChange={e => set('categoryId', e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            >
              <option value="">Uncategorised</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>

          <Field label="Video URL" hint="YouTube, Vimeo, or direct mp4/webm URL. Embedded at the top of the article.">
            <input
              type="url"
              value={draft.videoUrl}
              onChange={e => set('videoUrl', e.target.value)}
              placeholder="https://www.youtube.com/watch?v=…"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
            />
          </Field>

          <Field label="Body (Markdown)" hint="Headings (# ## ###), **bold**, *italic*, `code`, [links](url), - lists, > quotes, ```code blocks```.">
            {/* Editor / preview tabs visible on mobile; large screens see both side-by-side via the grid. */}
            <div className="lg:hidden flex gap-1 mb-2">
              <button
                type="button"
                onClick={() => setTab('edit')}
                className={`text-xs px-3 py-1 rounded ${tab === 'edit' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
              >Edit</button>
              <button
                type="button"
                onClick={() => setTab('preview')}
                className={`text-xs px-3 py-1 rounded ${tab === 'preview' ? 'bg-zinc-800 text-white' : 'text-zinc-500'}`}
              >Preview</button>
            </div>

            <textarea
              value={draft.body}
              onChange={e => set('body', e.target.value)}
              rows={18}
              className={`w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2.5 text-sm text-zinc-100 font-mono focus:outline-none focus:border-zinc-500 resize-y ${tab === 'preview' ? 'hidden lg:block' : ''}`}
            />
          </Field>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => save(draft.status)}
              disabled={saving || !draft.title.trim() || !draft.body.trim()}
              className="rounded-lg bg-white text-black font-medium text-sm px-4 h-10 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {saving ? 'Saving…' : existingSlug ? 'Save' : 'Create draft'}
            </button>
            {draft.status !== 'published' && (
              <button
                type="button"
                onClick={() => save('published')}
                disabled={saving || !draft.title.trim() || !draft.body.trim()}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-sm px-4 h-10 transition-colors disabled:opacity-50"
              >
                {saving ? '…' : 'Publish'}
              </button>
            )}
            {draft.status === 'published' && (
              <button
                type="button"
                onClick={() => save('draft')}
                disabled={saving}
                className="text-xs text-zinc-400 hover:text-white transition-colors"
              >
                Unpublish
              </button>
            )}
            <span className="flex-1" />
            {existingSlug && (
              <button
                type="button"
                onClick={deleteArticle}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                Delete
              </button>
            )}
          </div>
        </div>

        {/* ── Preview ── */}
        <div className={`${tab === 'edit' ? 'hidden lg:block' : ''} rounded-xl border border-zinc-800 bg-zinc-950 p-6 overflow-y-auto`}>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-4">
            Live preview
          </div>
          {draft.title && <h1 className="text-2xl font-bold text-zinc-50 mb-2">{draft.title}</h1>}
          {draft.summary && <p className="text-zinc-400 mb-4">{draft.summary}</p>}
          {draft.videoUrl && (
            <div className="text-xs text-zinc-500 italic mb-4">
              [Video preview shows at this point in the published page]
            </div>
          )}
          <Markdown source={draft.body} />
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-400 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-zinc-600 mt-1">{hint}</p>}
    </div>
  )
}
