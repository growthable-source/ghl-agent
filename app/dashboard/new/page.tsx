'use client'

import { useState } from 'react'
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
      if (!res.ok) throw new Error(data.error || 'Failed to create workspace')
      router.push(`/dashboard/${data.workspaceId}`)
    } catch (err: any) {
      setError(err.message)
      setCreating(false)
    }
  }

  return (
    <div className="p-8">
      <div className="max-w-lg mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Create a workspace</h1>
        <p className="text-zinc-400 text-sm mb-8">
          A workspace is where your AI agents, integrations, and contacts live. You can create multiple workspaces for different businesses.
        </p>

        <form onSubmit={handleCreate} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-zinc-300 mb-2">Workspace</label>
            <div className="flex items-center gap-3">
              {/* Icon button */}
              <button
                type="button"
                onClick={() => setShowIconPicker(!showIconPicker)}
                className="w-12 h-12 rounded-lg flex items-center justify-center text-2xl shrink-0 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 transition-colors"
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
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>

            {/* Icon picker grid */}
            {showIconPicker && (
              <div className="mt-2 p-3 rounded-lg bg-zinc-900 border border-zinc-800 grid grid-cols-8 gap-1">
                {WORKSPACE_ICONS.map(ic => (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => { setIcon(ic); setShowIconPicker(false) }}
                    className={`w-9 h-9 rounded-md flex items-center justify-center text-lg transition-colors hover:bg-zinc-700 ${
                      icon === ic ? 'bg-zinc-700 ring-1 ring-zinc-500' : ''
                    }`}
                  >
                    {ic}
                  </button>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-red-400 text-sm">{error}</p>}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={creating || !name.trim()}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-6 hover:bg-zinc-200 transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating…' : 'Create workspace'}
            </button>
            <Link href="/dashboard" className="text-sm text-zinc-500 hover:text-white transition-colors">
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
