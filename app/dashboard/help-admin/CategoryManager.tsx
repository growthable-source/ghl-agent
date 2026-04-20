'use client'

import { useState } from 'react'

interface Category {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  order: number
  articleCount: number
}

/**
 * Inline category CRUD. Simple list-plus-composer. Deliberately minimal —
 * categories don't need rich metadata beyond name / icon / description.
 * Slugs are generated server-side from the name.
 */
export default function CategoryManager({ initialCategories }: { initialCategories: Category[] }) {
  const [categories, setCategories] = useState<Category[]>(initialCategories)
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('')
  const [description, setDescription] = useState('')
  const [adding, setAdding] = useState(false)

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setAdding(true)
    try {
      const res = await fetch('/api/help/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, icon: icon || null, description: description || null }),
      })
      if (res.ok) {
        const { category } = await res.json()
        setCategories(c => [...c, { ...category, articleCount: 0 }])
        setName(''); setIcon(''); setDescription('')
      }
    } finally { setAdding(false) }
  }

  async function deleteCategory(slug: string) {
    if (!confirm('Delete this category? Articles inside will become uncategorised.')) return
    const res = await fetch(`/api/help/categories/${slug}`, { method: 'DELETE' })
    if (res.ok) setCategories(c => c.filter(x => x.slug !== slug))
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {categories.map(c => (
          <div key={c.id} className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-950 px-4 py-2.5">
            {c.icon ? <span className="text-lg">{c.icon}</span> : <span className="w-5" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm text-zinc-100">{c.name}</div>
              <div className="text-[11px] text-zinc-500 font-mono">/help/c/{c.slug} · {c.articleCount} articles</div>
            </div>
            <button
              type="button"
              onClick={() => deleteCategory(c.slug)}
              className="text-xs text-zinc-600 hover:text-red-400 transition-colors"
            >
              Delete
            </button>
          </div>
        ))}
      </div>

      <form onSubmit={addCategory} className="rounded-lg border border-dashed border-zinc-700 bg-zinc-950 p-3 flex items-center gap-2">
        <input
          type="text"
          value={icon}
          onChange={e => setIcon(e.target.value)}
          placeholder="🚀"
          className="w-14 bg-zinc-900 border border-zinc-700 rounded px-2 py-2 text-sm text-white text-center focus:outline-none focus:border-zinc-500"
        />
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Category name"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
        />
        <input
          type="text"
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Short description (optional)"
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
        />
        <button
          type="submit"
          disabled={adding || !name.trim()}
          className="text-sm font-medium bg-white text-black rounded px-4 py-2 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>
    </div>
  )
}
