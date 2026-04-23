'use client'

import { useState } from 'react'

interface FeedbackTurn {
  role: 'user' | 'agent'
  content: string
}

interface Props {
  workspaceId: string
  agentId: string
  conversation: FeedbackTurn[]
  flaggedReplyIndex: number
}

type State =
  | { kind: 'idle' }
  | { kind: 'narrative' }           // user clicked thumbs down, typing narrative
  | { kind: 'sending' }              // request in flight
  | { kind: 'done-up' }              // thumbs up acknowledged
  | { kind: 'done-applied'; learningId: string | null }
  | { kind: 'done-skipped' }         // reviewer declined
  | { kind: 'error'; message: string }

/**
 * Inline thumbs up / thumbs down on a single agent reply in the
 * playground. Thumbs down opens a textarea for the user to explain
 * what went wrong; submitting sends the whole conversation + narrative
 * to the feedback endpoint, which invokes Claude and (maybe) creates +
 * auto-applies a learning on the target agent.
 *
 * The conversation prop is the FULL playground transcript up to and
 * including the flagged reply. flaggedReplyIndex points at the reply
 * being rated. Both are captured when the component renders so the
 * server sees exactly what the user saw, even if the user keeps
 * chatting after clicking thumbs.
 */
export default function PlaygroundFeedback({
  workspaceId,
  agentId,
  conversation,
  flaggedReplyIndex,
}: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [narrative, setNarrative] = useState('')

  async function send(rating: 'up' | 'down', narrative?: string) {
    setState({ kind: 'sending' })
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agent-feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          conversation,
          flaggedReplyIndex,
          rating,
          narrative: narrative ?? '',
        }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let msg = text.slice(0, 300)
        try {
          const parsed = JSON.parse(text)
          if (parsed?.error) msg = parsed.error
        } catch { /* */ }
        throw new Error(`${res.status} — ${msg}`)
      }
      const data = await res.json()
      if (rating === 'up') {
        setState({ kind: 'done-up' })
      } else if (data.outcome === 'applied') {
        setState({ kind: 'done-applied', learningId: data.learningId ?? null })
      } else {
        setState({ kind: 'done-skipped' })
      }
    } catch (e: any) {
      setState({ kind: 'error', message: e.message ?? 'Failed' })
    }
  }

  // ── Render states ─────────────────────────────────────────────────
  if (state.kind === 'done-up') {
    return <p className="text-[11px] text-zinc-500 mt-1">Thanks for the signal.</p>
  }
  if (state.kind === 'done-applied') {
    return (
      <p className="text-[11px] text-emerald-400 mt-1">
        ✓ Applied to your agent — same mistake won&apos;t happen on the next inbound.
      </p>
    )
  }
  if (state.kind === 'done-skipped') {
    return (
      <p className="text-[11px] text-zinc-500 mt-1">
        Noted — reviewer decided no prompt change was warranted this time.
      </p>
    )
  }
  if (state.kind === 'error') {
    return (
      <p className="text-[11px] text-red-400 mt-1">
        {state.message}{' '}
        <button onClick={() => setState({ kind: 'idle' })} className="underline">Try again</button>
      </p>
    )
  }

  if (state.kind === 'narrative' || state.kind === 'sending') {
    return (
      <div className="mt-1 space-y-1.5">
        <textarea
          value={narrative}
          onChange={e => setNarrative(e.target.value)}
          placeholder="What was wrong about this reply? (optional, but more context → better fix)"
          rows={2}
          disabled={state.kind === 'sending'}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-[11px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
          maxLength={1000}
          autoFocus
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => send('down', narrative)}
            disabled={state.kind === 'sending'}
            className="text-[11px] font-medium bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-800 text-white rounded px-2.5 py-1 transition-colors"
          >
            {state.kind === 'sending' ? 'Reviewing…' : 'Submit feedback'}
          </button>
          <button
            type="button"
            onClick={() => { setState({ kind: 'idle' }); setNarrative('') }}
            disabled={state.kind === 'sending'}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  // idle
  return (
    <div className="flex items-center gap-1 mt-1">
      <button
        type="button"
        onClick={() => send('up')}
        className="text-zinc-600 hover:text-emerald-400 transition-colors text-sm leading-none px-1"
        title="This reply was good"
        aria-label="Thumbs up"
      >
        👍
      </button>
      <button
        type="button"
        onClick={() => setState({ kind: 'narrative' })}
        className="text-zinc-600 hover:text-amber-400 transition-colors text-sm leading-none px-1"
        title="This reply was wrong — tell us why"
        aria-label="Thumbs down"
      >
        👎
      </button>
    </div>
  )
}
