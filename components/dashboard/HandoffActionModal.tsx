'use client'

import { useEffect, useState } from 'react'
import { humanizePauseReason } from '@/lib/humanize-pause-reason'

export type HandoffAction = 'takeover' | 'resume'

interface Props {
  open: boolean
  action: HandoffAction
  workspaceId: string
  agentId: string
  agentName?: string
  contactId: string
  pauseReason: string | null
  onClose: () => void
  onDone: () => void   // called after a successful POST so the parent can refresh
}

const COPY: Record<HandoffAction, {
  title: string
  submit: string
  noteLabel: string
  notePlaceholder: string
  successFlash: string
}> = {
  takeover: {
    title: 'Take over conversation',
    submit: 'Take over',
    noteLabel: 'Why are you taking over? (optional)',
    notePlaceholder: 'e.g. Contact is heated, will call them directly',
    successFlash: '✓ Taken over. Agent paused until you resume it.',
  },
  resume: {
    title: 'Hand back to the agent',
    submit: 'Resume agent',
    noteLabel: 'Note for the agent (optional)',
    notePlaceholder: "e.g. I confirmed their budget is $40k and they prefer the silver one. Continue from there.",
    successFlash: '✓ Agent resumed with your context.',
  },
}

export default function HandoffActionModal({
  open, action, workspaceId, agentId, agentName, contactId, pauseReason,
  onClose, onDone,
}: Props) {
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on every open so stale content from a previous contact doesn't
  // leak into the new action.
  useEffect(() => {
    if (open) { setNote(''); setError(null); setSubmitting(false) }
  }, [open, contactId, action])

  if (!open) return null

  const copy = COPY[action]
  const reason = humanizePauseReason(pauseReason)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      const endpoint = action === 'takeover'
        ? `/api/workspaces/${workspaceId}/takeover`
        : `/api/workspaces/${workspaceId}/conversations/resume`
      // The takeover endpoint still expects `reason`; resume uses `note`.
      // Send both under one body to keep the client simple.
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          contactId,
          reason: note || null,   // takeover
          note: note || null,     // resume
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed (${res.status})`)
      }
      onDone()
    } catch (err: any) {
      setError(err.message || 'Failed')
      setSubmitting(false)
    }
  }

  return (
    // Fixed-position overlay so the parent doesn't need its own positioning
    // context. Click-outside dismisses.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <h3 className="text-base font-semibold text-white">{copy.title}</h3>
          {agentName && <p className="text-xs text-zinc-500 mt-0.5">on <span className="text-zinc-300">{agentName}</span></p>}
        </div>

        <div className="p-5 space-y-4">
          {/* Why-was-it-paused block — always show so the operator knows
              the context they're deciding on. */}
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 mb-1">
              Why the agent stopped
            </p>
            <p className="text-sm font-medium text-zinc-200">{reason.short}</p>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{reason.long}</p>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">{copy.noteLabel}</label>
            <textarea
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder={copy.notePlaceholder}
              rows={4}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
            />
            {action === 'resume' && (
              <p className="text-[11px] text-zinc-600 mt-1.5 leading-relaxed">
                The agent sees this note on its very next reply, under a{' '}
                <span className="font-mono text-zinc-500">handoff_context</span> line. Use it to
                pass along what you already covered with the contact so the agent doesn&apos;t
                repeat it.
              </p>
            )}
          </div>

          {error && (
            <p className="text-xs text-red-400">{error}</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="text-xs font-medium text-zinc-400 hover:text-white px-3 py-2 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className={`text-xs font-medium rounded-lg px-3 py-2 transition-colors disabled:opacity-50 ${
              action === 'takeover'
                ? 'bg-amber-500 text-black hover:bg-amber-400'
                : 'bg-emerald-500 text-black hover:bg-emerald-400'
            }`}
          >
            {submitting ? 'Saving…' : copy.submit}
          </button>
        </div>
      </form>
    </div>
  )
}
