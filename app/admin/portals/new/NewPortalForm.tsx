'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Workspace { id: string; name: string; slug: string; brandCount: number }

export default function NewPortalForm({ workspaces }: { workspaces: Workspace[] }) {
  const router = useRouter()
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Auto-derive slug from the name as the operator types, but only if
  // they haven't manually edited the slug field.
  const [slugTouched, setSlugTouched] = useState(false)
  function onName(v: string) {
    setName(v)
    if (!slugTouched) {
      setSlug(v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60))
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/portals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, name, slug }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(body?.error ?? `Error ${res.status}`)
        setSubmitting(false)
        return
      }
      router.push(`/admin/portals/${body.portal.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
      setSubmitting(false)
    }
  }

  if (workspaces.length === 0) {
    return (
      <div className="border border-zinc-800 rounded-lg p-6 bg-zinc-900/40">
        <p className="text-sm text-zinc-400">
          No workspaces exist yet. A portal needs a workspace whose brands it can expose.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <Field label="Workspace" hint="The portal will be scoped to brands inside this workspace.">
        <select
          value={workspaceId}
          onChange={e => setWorkspaceId(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
        >
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>
              {w.name} ({w.brandCount} {w.brandCount === 1 ? 'brand' : 'brands'})
            </option>
          ))}
        </select>
      </Field>
      <Field label="Portal name" hint="Shown to customers on the login page and in invite emails.">
        <input
          required
          value={name}
          onChange={e => onName(e.target.value)}
          placeholder="Acme Co. Customer Portal"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 focus:border-amber-400 outline-none"
        />
      </Field>
      <Field label="Slug" hint="URL-safe identifier. Lowercase letters, numbers, and dashes.">
        <input
          required
          value={slug}
          onChange={e => { setSlug(e.target.value); setSlugTouched(true) }}
          pattern="[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
          placeholder="acme"
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-100 font-mono focus:border-amber-400 outline-none"
        />
      </Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex items-center gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !name || !slug}
          className="px-3 py-1.5 rounded bg-amber-400 text-zinc-950 text-sm font-medium hover:bg-amber-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? 'Creating…' : 'Create portal'}
        </button>
      </div>
    </form>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-zinc-300 mb-1.5">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500 mt-1.5">{hint}</span>}
    </label>
  )
}
