'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import BrandPicker, { type BrandWithWorkspace } from '../BrandPicker'

export default function NewPortalForm({ allBrands }: { allBrands: BrandWithWorkspace[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [slugTouched, setSlugTouched] = useState(false)
  const [brandIds, setBrandIds] = useState<Set<string>>(new Set())

  function toggleBrand(id: string) {
    setBrandIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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
        body: JSON.stringify({ name, slug, brandIds: Array.from(brandIds) }),
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

  return (
    <form onSubmit={onSubmit} className="space-y-5">
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
      <div>
        <span className="block text-sm text-zinc-300 mb-1.5">
          Brands <span className="text-zinc-500">({brandIds.size} selected)</span>
        </span>
        <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30">
          <BrandPicker allBrands={allBrands} selected={brandIds} onToggle={toggleBrand} />
        </div>
        <span className="block text-xs text-zinc-500 mt-1.5">
          Optional. Brands from any workspace; customers only see the brands you later assign them.
        </span>
      </div>
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
