'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ApiKeyRow {
  id: string
  name: string
  prefix: string
  lastUsedAt: string | null
  revokedAt: string | null
  createdAt: string
}

interface Props {
  workspaceId: string
}

export default function ApiAccessClient({ workspaceId }: Props) {
  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)

  // create-key form state
  const [showForm, setShowForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // just-created key reveal (shown once, then gone)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // per-key revoke busy indicator
  const [revoking, setRevoking] = useState<string | null>(null)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`)
      if (res.ok) {
        const data = await res.json()
        setKeys(data.keys || [])
      }
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { load() }, [load])

  // Focus the name input whenever the inline form opens
  useEffect(() => {
    if (showForm) {
      setTimeout(() => nameInputRef.current?.focus(), 50)
    }
  }, [showForm])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCreateError(data.error || 'Failed to create key')
        return
      }
      setRevealedKey(data.key)
      setCopied(false)
      setNewName('')
      setShowForm(false)
      await load()
    } catch {
      setCreateError('Network error — please try again')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(keyId: string, keyName: string) {
    if (!confirm(`Revoke the key "${keyName}"? Any applications using it will stop working immediately.`)) return
    setRevoking(keyId)
    setRevokeError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/api-keys/${keyId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setRevokeError(data.error || 'Failed to revoke key')
      } else {
        await load()
      }
    } catch {
      setRevokeError('Network error — please try again')
    } finally {
      setRevoking(null)
    }
  }

  async function copyKey(raw: string) {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // clipboard may be blocked — let the user select manually
    }
  }

  const activeKeys = keys.filter(k => !k.revokedAt)
  const revokedKeys = keys.filter(k => k.revokedAt)

  if (loading) {
    return (
      <div className="flex-1 p-8">
        <div className="max-w-4xl mx-auto">
          <div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>API Access</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Create API keys so external apps can read your support metrics. Treat keys like passwords — they grant read access to this workspace.
            </p>
          </div>
          {!showForm && (
            <button
              onClick={() => { setShowForm(true); setCreateError(null); setRevealedKey(null) }}
              className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
            >
              Create key
            </button>
          )}
        </div>

        {/* Just-created key reveal — shown once */}
        {revealedKey && (
          <div
            className="mb-6 rounded-xl border p-5"
            style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg, rgba(245,158,11,0.08))' }}
          >
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--accent-amber)' }}>
              Copy this key now — it won&apos;t be shown again
            </p>
            <p className="text-xs mb-3" style={{ color: 'var(--text-secondary)' }}>
              Only a hashed fingerprint is stored. Once you navigate away, this key cannot be recovered.
            </p>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded-lg px-3 py-2 text-sm font-mono break-all"
                style={{ background: 'var(--surface-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                {revealedKey}
              </code>
              <button
                onClick={() => copyKey(revealedKey)}
                className="shrink-0 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
                style={copied
                  ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                  : { background: 'var(--surface-tertiary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <button
              onClick={() => setRevealedKey(null)}
              className="mt-3 text-xs"
              style={{ color: 'var(--text-tertiary)' }}
            >
              I&apos;ve copied it — dismiss
            </button>
          </div>
        )}

        {/* Inline create form */}
        {showForm && (
          <form
            onSubmit={handleCreate}
            className="mb-6 rounded-xl border p-5"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>New API key</h2>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                ref={nameInputRef}
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Operations dashboard"
                maxLength={80}
                className="flex-1 rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--input-bg)', color: 'var(--input-text)', border: '1px solid var(--input-border)' }}
              />
              <div className="flex gap-2 shrink-0">
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50"
                  style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                >
                  {creating ? 'Creating…' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowForm(false); setCreateError(null); setNewName('') }}
                  className="text-sm px-4 py-2 rounded-lg"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                >
                  Cancel
                </button>
              </div>
            </div>
            {createError && (
              <p className="mt-2 text-xs" style={{ color: 'var(--accent-red)' }}>{createError}</p>
            )}
          </form>
        )}

        {/* Active keys table */}
        <div
          className="rounded-xl border overflow-hidden mb-8"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <div
            className="px-4 py-3 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
              {activeKeys.length} active key{activeKeys.length === 1 ? '' : 's'}
            </span>
          </div>

          {revokeError && (
            <div className="px-4 py-2 border-b text-xs" style={{ borderColor: 'var(--border)', color: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}>
              {revokeError}
            </div>
          )}

          {activeKeys.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                No active API keys. Click &ldquo;Create key&rdquo; to generate one.
              </p>
            </div>
          ) : (
            <>
              {/* Column headers */}
              <div
                className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 border-b text-[10px] uppercase tracking-wider font-semibold"
                style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
              >
                <span>Name</span>
                <span className="hidden sm:block">Key prefix</span>
                <span className="hidden sm:block">Last used</span>
                <span>Created</span>
              </div>
              {activeKeys.map(k => (
                <div
                  key={k.id}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-4 items-center px-4 py-3 border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {k.name}
                  </p>
                  <code
                    className="hidden sm:block text-xs font-mono px-2 py-0.5 rounded"
                    style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}
                  >
                    {k.prefix}…
                  </code>
                  <span
                    className="hidden sm:block text-xs"
                    style={{ color: 'var(--text-tertiary)' }}
                    title={k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : undefined}
                  >
                    {k.lastUsedAt ? timeAgo(k.lastUsedAt) : 'Never'}
                  </span>
                  <div className="flex items-center gap-3">
                    <span
                      className="text-xs"
                      style={{ color: 'var(--text-tertiary)' }}
                      title={new Date(k.createdAt).toLocaleString()}
                    >
                      {shortDate(k.createdAt)}
                    </span>
                    <button
                      onClick={() => handleRevoke(k.id, k.name)}
                      disabled={revoking === k.id}
                      className="text-xs disabled:opacity-50 transition-colors"
                      style={{ color: 'var(--accent-red)' }}
                    >
                      {revoking === k.id ? 'Revoking…' : 'Revoke'}
                    </button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Revoked keys (collapsed list at bottom) */}
        {revokedKeys.length > 0 && (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div
              className="px-4 py-3 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>
                {revokedKeys.length} revoked key{revokedKeys.length === 1 ? '' : 's'}
              </span>
            </div>
            {revokedKeys.map(k => (
              <div
                key={k.id}
                className="flex items-center gap-4 px-4 py-3 border-t opacity-50"
                style={{ borderColor: 'var(--border)' }}
              >
                <p className="flex-1 text-sm truncate line-through" style={{ color: 'var(--text-secondary)' }}>
                  {k.name}
                </p>
                <code
                  className="text-xs font-mono px-2 py-0.5 rounded hidden sm:block"
                  style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}
                >
                  {k.prefix}…
                </code>
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  Revoked {k.revokedAt ? shortDate(k.revokedAt) : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return shortDate(iso)
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  } catch {
    return iso
  }
}
