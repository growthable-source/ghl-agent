'use client'

/**
 * Haiku-generated quick summary of the conversation. Cached on the
 * conversation row server-side; "Refresh" forces a regenerate.
 * Operators scanning a busy inbox can get the gist without reading
 * the full transcript.
 */

import { useEffect, useState } from 'react'
import { relTime } from './conversation-helpers'

export default function AISummarySection({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [summary, setSummary] = useState<string | null>(null)
  const [summaryAt, setSummaryAt] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/summary`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        if (d.summary) setSummary(d.summary)
        if (d.summaryAt) setSummaryAt(d.summaryAt)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [workspaceId, conversationId])

  async function generate(force: boolean) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error || 'Failed to summarise')
      setSummary(d.summary || null)
      setSummaryAt(d.summaryAt || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to summarise')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5 border-b border-zinc-800">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">AI summary</p>
        <button
          onClick={() => generate(!!summary)}
          disabled={busy}
          className="text-[10px] font-semibold text-orange-400 hover:text-orange-300 disabled:opacity-50"
        >
          {busy ? 'Working…' : summary ? 'Refresh' : 'Generate'}
        </button>
      </div>
      {summary ? (
        <>
          <p className="text-xs text-zinc-200 whitespace-pre-wrap leading-relaxed">{summary}</p>
          {summaryAt && (
            <p className="text-[10px] text-zinc-600 mt-2">Updated {relTime(summaryAt)}</p>
          )}
        </>
      ) : (
        <p className="text-[11px] text-zinc-500">
          Click Generate to get a Haiku-powered overview of what this chat is about.
        </p>
      )}
      {error && <p className="text-[11px] text-red-400 mt-2">{error}</p>}
    </div>
  )
}
