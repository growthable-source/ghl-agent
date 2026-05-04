'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ListSummary {
  id: string
  name: string
  description: string | null
  type: string
  memberCount: number
  createdAt: string
}

export default function ListsClient({
  workspaceId,
  initialLists,
}: {
  workspaceId: string
  initialLists: ListSummary[]
}) {
  const router = useRouter()
  const [lists, setLists] = useState(initialLists)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/native/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, type: 'static' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Failed to create list')
      }
      const j = await res.json()
      setLists([{ id: j.list.id, name: j.list.name, description: j.list.description, type: j.list.type, memberCount: 0, createdAt: j.list.createdAt }, ...lists])
      setName('')
      setDescription('')
      setCreating(false)
      router.refresh()
    } catch (e: any) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!confirm('Delete this list? Members are NOT deleted, only the grouping is.')) return
    await fetch(`/api/workspaces/${workspaceId}/native/lists/${id}`, { method: 'DELETE' })
    setLists(lists.filter(l => l.id !== id))
    router.refresh()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Lists</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Static segments for outbound campaigns and follow-ups.
            </p>
          </div>
          {!creating && (
            <button
              onClick={() => setCreating(true)}
              className="text-xs font-semibold px-3 h-9 inline-flex items-center rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              + New list
            </button>
          )}
        </div>

        {creating && (
          <div className="rounded-xl border p-4 mb-6 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="List name (e.g. Trade show — May 2026)"
              className="w-full px-3 h-9 rounded-lg border text-sm"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            />
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional description"
              className="w-full px-3 h-9 rounded-lg border text-sm"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            />
            {err && <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{err}</p>}
            <div className="flex items-center gap-2">
              <button
                onClick={create}
                disabled={busy || !name.trim()}
                className="text-xs font-semibold px-3 h-8 rounded-md transition-opacity hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {busy ? 'Creating…' : 'Create'}
              </button>
              <button
                onClick={() => { setCreating(false); setName(''); setDescription(''); setErr(null) }}
                className="text-xs px-3 h-8 rounded-md"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {lists.length === 0 && !creating ? (
          <div
            className="text-center py-16 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No lists yet</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Create a list to group contacts for outbound campaigns.</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            {lists.map((l, i) => (
              <div
                key={l.id}
                className="flex items-center gap-3 px-4 py-3"
                style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}
              >
                <Link href={`/dashboard/${workspaceId}/lists/${l.id}`} className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{l.name}</p>
                  {l.description && (
                    <p className="text-xs truncate mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{l.description}</p>
                  )}
                </Link>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  {l.memberCount} {l.memberCount === 1 ? 'member' : 'members'}
                </span>
                <button
                  onClick={() => remove(l.id)}
                  className="text-xs px-2 py-1 rounded-md transition-opacity hover:opacity-80"
                  style={{ color: 'var(--accent-red)' }}
                  aria-label="Delete list"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
