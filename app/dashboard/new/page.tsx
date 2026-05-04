'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

const WORKSPACE_ICONS = [
  '🚀', '⚡', '🎯', '💎', '🔥', '🌊', '🏔️', '🌿',
  '🦊', '🦅', '🐺', '🦁', '🐻', '🦉', '🐬', '🦈',
  '🏢', '🏗️', '🎨', '🔬', '💡', '🛡️', '⭐', '🌙',
]

export default function NewWorkspacePage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('🚀')
  const [showIconPicker, setShowIconPicker] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [existingCount, setExistingCount] = useState<number | null>(null)

  // Fetch existing workspace count to show context
  useEffect(() => {
    fetch('/api/workspaces')
      .then(r => r.json())
      .then(data => setExistingCount(data.workspaces?.length ?? 0))
      .catch(() => {})
  }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError('')

    try {
      const res = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), icon }),
      })
      const data = await res.json()
      if (!res.ok) {
        // Handle workspace limit error with upgrade prompt
        if (data.code === 'WORKSPACE_LIMIT') {
          setError('You\'ve reached your workspace limit. Upgrade your plan to create more.')
        } else {
          throw new Error(data.error || 'Failed to create workspace')
        }
        setCreating(false)
        return
      }
      router.push(`/dashboard/${data.workspaceId}`)
    } catch (err: any) {
      setError(err.message)
      setCreating(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Create a workspace</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-secondary)' }}>
          A workspace is where your AI agents, integrations, and contacts live.
          {existingCount != null && existingCount > 0 && (
            <> You currently have {existingCount} workspace{existingCount !== 1 ? 's' : ''}.</>
          )}
        </p>

        {/* Trial info for new workspaces */}
        <div
          className="rounded-lg px-4 py-3 mb-6 flex items-start gap-3"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--surface-secondary)',
          }}
        >
          <span className="text-lg mt-0.5">🎁</span>
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>7-day free trial included</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              Every new workspace starts with full access to Growth-tier features for 7 days.
              No credit card required.
            </p>
          </div>
        </div>

        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Workspace</label>
            <div className="flex items-center gap-3">
              {/* Icon button */}
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0 transition-colors"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--input-text)',
                }}
                title="Choose icon"
              >
                {icon}
              </button>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Acme Corp, My Clinic"
                required
                autoFocus
                className="w-full rounded-lg px-4 py-3 text-sm focus:outline-none"
                style={{
                  background: 'var(--input-bg)',
                  border: '1px solid var(--input-border)',
                  color: 'var(--input-text)',
                }}
              />
            </div>

            {/* Icon picker grid */}
            {showIconPicker && (
              <div
                className="mt-2 p-3 rounded-lg grid grid-cols-8 gap-1"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                {WORKSPACE_ICONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => { setIcon(ic); setShowIconPicker(false) }}
                    className="w-9 h-9 rounded-md flex items-center justify-center text-lg transition-colors"
                    style={
                      icon === ic
                        ? {
                            background: 'var(--surface-tertiary)',
                            boxShadow: '0 0 0 1px var(--border-secondary)',
                          }
                        : undefined
                    }
                  >
                    {ic}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && (
            <div
              className="rounded-lg px-4 py-3"
              style={{
                border: '1px solid var(--accent-red)',
                background: 'var(--accent-red-bg)',
              }}
            >
              <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>
              {error.includes('limit') && (
                <Link
                  href="/dashboard"
                  className="text-xs hover:underline mt-1 inline-block"
                  style={{ color: '#fa4d2e' }}
                >
                  Go to billing to upgrade →
                </Link>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="inline-flex items-center justify-center rounded-lg font-medium text-sm h-10 px-6 transition-colors"
              style={
                creating || !name.trim()
                  ? {
                      background: 'var(--surface-tertiary)',
                      color: 'var(--text-muted)',
                      cursor: 'not-allowed',
                    }
                  : {
                      background: 'var(--btn-primary-bg)',
                      color: 'var(--btn-primary-text)',
                    }
              }
            >
              {creating ? 'Creating...' : 'Create workspace'}
            </button>
            <Link
              href="/dashboard"
              className="text-sm transition-colors"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
