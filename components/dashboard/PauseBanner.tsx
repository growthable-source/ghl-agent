'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface PauseState {
  isPaused: boolean
  pausedAt: string | null
  pausedBy: string | null
}

export default function PauseBanner() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [state, setState] = useState<PauseState>({ isPaused: false, pausedAt: null, pausedBy: null })
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!workspaceId || workspaceId === 'undefined' || workspaceId === 'new' || workspaceId === 'settings') return
    fetch(`/api/workspaces/${workspaceId}/pause`)
      .then(r => r.json())
      .then(data => setState(data))
      .catch(() => {})
  }, [workspaceId])

  if (!workspaceId || workspaceId === 'undefined' || workspaceId === 'new' || workspaceId === 'settings') return null

  async function toggle(pause: boolean) {
    setBusy(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/pause`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paused: pause }),
      })
      if (res.ok) {
        const data = await res.json()
        setState(data)
        setConfirming(false)
      }
    } finally { setBusy(false) }
  }

  if (!state.isPaused) {
    // Render a thin floating pause button in the top-right
    return (
      <div className="fixed bottom-6 right-6 z-40">
        {confirming ? (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-zinc-900 border border-red-500/40 shadow-xl">
            <span className="text-xs text-zinc-300">Pause all agents in this workspace?</span>
            <button
              onClick={() => toggle(true)}
              disabled={busy}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              {busy ? '...' : 'Pause all'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="text-xs font-medium px-2 py-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirming(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-full bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-red-400 hover:border-red-500/40 transition-colors shadow-lg text-xs font-medium"
            title="Emergency pause — stops all agents in this workspace"
          >
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
            </svg>
            Pause all agents
          </button>
        )}
      </div>
    )
  }

  // Paused state — top banner
  const pausedAgo = state.pausedAt ? Math.round((Date.now() - new Date(state.pausedAt).getTime()) / 60000) : 0
  return (
    <div className="w-full px-4 py-3 border-b border-red-500/30"
      style={{ background: 'linear-gradient(90deg, rgba(239,68,68,0.15), rgba(220,38,38,0.08))' }}
    >
      <div className="max-w-6xl mx-auto flex items-center gap-3">
        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-red-300">
            All agents paused
          </p>
          <p className="text-xs text-red-400/70">
            No messages will be sent. Paused {pausedAgo < 1 ? 'just now' : `${pausedAgo}m ago`}.
          </p>
        </div>
        <button
          onClick={() => toggle(false)}
          disabled={busy}
          className="text-xs font-semibold px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 hover:bg-red-500/30 transition-colors"
        >
          {busy ? 'Resuming...' : 'Resume agents'}
        </button>
      </div>
    </div>
  )
}
