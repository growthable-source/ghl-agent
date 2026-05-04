'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Member {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
  isSuppressed?: boolean
}

interface PickerContact {
  id: string
  firstName: string | null
  lastName: string | null
  email: string | null
  phone: string | null
}

export default function ListDetailClient({
  workspaceId,
  list,
  initialMembers,
  pickerContacts,
}: {
  workspaceId: string
  list: { id: string; name: string; description: string | null; type: string; memberCount: number }
  initialMembers: Member[]
  pickerContacts: PickerContact[]
}) {
  const router = useRouter()
  const [members, setMembers] = useState<Member[]>(initialMembers)
  const [picker, setPicker] = useState<PickerContact[]>(pickerContacts)
  const [picking, setPicking] = useState(false)
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState<PickerContact[]>([])
  const [busy, setBusy] = useState(false)

  const addMembers = async (contactIds: string[]) => {
    if (contactIds.length === 0) return
    setBusy(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/native/lists/${list.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactIds }),
      })
      // Move the picked contacts into the members list locally so the UI
      // updates without a round-trip refresh.
      const added = picker.filter(p => contactIds.includes(p.id))
      setMembers([
        ...added.map(p => ({ ...p, isSuppressed: false })),
        ...members,
      ])
      setPicker(picker.filter(p => !contactIds.includes(p.id)))
      setSearchResults(searchResults.filter(p => !contactIds.includes(p.id)))
      router.refresh()
    } finally {
      setBusy(false)
    }
  }

  const removeMember = async (id: string) => {
    if (!confirm('Remove from list? The contact itself stays.')) return
    await fetch(`/api/workspaces/${workspaceId}/native/lists/${list.id}/members`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contactIds: [id] }),
    })
    setMembers(members.filter(m => m.id !== id))
    router.refresh()
  }

  const runSearch = async (q: string) => {
    setSearch(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    const url = new URL(`/api/workspaces/${workspaceId}/native/contacts`, window.location.origin)
    url.searchParams.set('q', q)
    url.searchParams.set('pageSize', '20')
    const res = await fetch(url.toString())
    if (!res.ok) return
    const j = await res.json()
    const memberIds = new Set(members.map(m => m.id))
    setSearchResults(j.contacts.filter((c: any) => !memberIds.has(c.id)))
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <Link href={`/dashboard/${workspaceId}/lists`} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>← All lists</Link>
            <h1 className="text-2xl font-semibold tracking-tight mt-1">{list.name}</h1>
            {list.description && (
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{list.description}</p>
            )}
            <p className="text-xs mt-2" style={{ color: 'var(--text-tertiary)' }}>
              {list.memberCount} {list.memberCount === 1 ? 'member' : 'members'} · {list.type === 'smart' ? 'smart list' : 'static list'}
            </p>
          </div>
          {!picking && (
            <button
              onClick={() => setPicking(true)}
              className="text-xs font-semibold px-3 h-9 rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              + Add members
            </button>
          )}
        </div>

        {picking && (
          <div className="rounded-xl border p-4 mb-6 space-y-3" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Add members</p>
              <button onClick={() => setPicking(false)} className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Done</button>
            </div>
            <input
              value={search}
              onChange={e => runSearch(e.target.value)}
              placeholder="Search contacts by name, email, or phone…"
              className="w-full px-3 h-9 rounded-md border text-sm"
              style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)' }}
            />
            <div className="max-h-72 overflow-y-auto rounded-md border" style={{ borderColor: 'var(--border)' }}>
              {(search ? searchResults : picker).map(c => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '(no name)'
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => addMembers([c.id])}
                    disabled={busy}
                    className="w-full grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-center px-3 py-2 text-left transition-opacity hover:opacity-90 border-t"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{name}</span>
                    <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.email ?? '—'}</span>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone ?? '—'}</span>
                    <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>+ Add</span>
                  </button>
                )
              })}
              {(search ? searchResults : picker).length === 0 && (
                <p className="text-xs px-3 py-4 text-center" style={{ color: 'var(--text-tertiary)' }}>
                  {search ? 'No matches.' : 'No more contacts to add.'}
                </p>
              )}
            </div>
          </div>
        )}

        {members.length === 0 ? (
          <div
            className="text-center py-12 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No members yet</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Use "+ Add members" or import a CSV with this list selected.</p>
          </div>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
            <div
              className="grid items-center gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold border-b"
              style={{
                gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.6fr) 80px',
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
                background: 'var(--surface-secondary)',
              }}
            >
              <span>Name</span>
              <span>Email</span>
              <span>Phone</span>
              <span>Status</span>
              <span className="text-right">Action</span>
            </div>
            {members.map((m, i) => {
              const name = [m.firstName, m.lastName].filter(Boolean).join(' ') || '(no name)'
              return (
                <div
                  key={m.id}
                  className="grid items-center gap-3 px-4 py-3"
                  style={{
                    gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,0.6fr) 80px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--border)',
                  }}
                >
                  <Link href={`/dashboard/${workspaceId}/contacts/${m.id}`} className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{name}</Link>
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{m.email ?? '—'}</span>
                  <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{m.phone ?? '—'}</span>
                  <span className="text-xs" style={{ color: m.isSuppressed ? 'var(--accent-red)' : 'var(--accent-emerald)' }}>
                    {m.isSuppressed ? 'opted out' : 'active'}
                  </span>
                  <button
                    onClick={() => removeMember(m.id)}
                    className="text-xs text-right transition-opacity hover:opacity-80"
                    style={{ color: 'var(--accent-red)' }}
                  >
                    Remove
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
