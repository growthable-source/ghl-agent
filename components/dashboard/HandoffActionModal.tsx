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

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'SMS', label: 'SMS' },
  { value: 'WhatsApp', label: 'WhatsApp' },
  { value: 'Email', label: 'Email' },
  { value: 'FB', label: 'Facebook Messenger' },
  { value: 'IG', label: 'Instagram DM' },
  { value: 'GMB', label: 'Google Business' },
  { value: 'Live_Chat', label: 'Live Chat' },
]

export default function HandoffActionModal({
  open, action, workspaceId, agentId, agentName, contactId, pauseReason,
  onClose, onDone,
}: Props) {
  const [note, setNote] = useState('')
  const [sendFollowUpNow, setSendFollowUpNow] = useState(false)
  const [channel, setChannel] = useState('SMS')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset on every open so stale content from a previous contact doesn't
  // leak into the new action.
  useEffect(() => {
    if (open) {
      setNote('')
      setSendFollowUpNow(false)
      setChannel('SMS')
      setError(null)
      setSubmitting(false)
    }
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
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId,
          contactId,
          reason: note || null,        // takeover
          note: note || null,          // resume
          sendFollowUpNow,             // resume only; takeover ignores
          channel: sendFollowUpNow ? channel : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `Failed (${res.status})`)
      }
      // If we asked for a follow-up but the server skipped (e.g. outside
      // working hours), surface the skip reason rather than silently
      // pretending we sent.
      if (action === 'resume' && sendFollowUpNow) {
        const data = await res.json().catch(() => ({}))
        if (data?.followUp && data.followUp.sent === false && data.followUp.skipReason) {
          setError(
            data.followUp.skipReason === 'outside_working_hours'
              ? 'Agent unpaused, but the follow-up was skipped — outside working hours. Turn off working hours or wait for the next window.'
              : `Agent unpaused, but the follow-up didn't send: ${data.followUp.skipReason}`,
          )
          setSubmitting(false)
          return
        }
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

          {/* ── Send follow-up now ──
              Only shown on resume. Without this, unpausing is silent —
              the agent just waits for the contact's next inbound. With
              it, we run the agent immediately to compose + send an
              outbound using the handoff note as context. */}
          {action === 'resume' && (
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={sendFollowUpNow}
                  onChange={e => setSendFollowUpNow(e.target.checked)}
                  className="mt-0.5 accent-emerald-500"
                />
                <span className="text-sm text-zinc-200 leading-snug">
                  Send a follow-up message now
                  <span className="block text-[11px] text-zinc-500 mt-0.5">
                    Fires the agent immediately so it composes + sends a natural follow-up
                    using your note. Without this, the agent just waits for the contact&apos;s
                    next inbound.
                  </span>
                </span>
              </label>

              {sendFollowUpNow && (
                <div className="pl-6">
                  <label className="block text-[11px] text-zinc-500 mb-1.5">Channel</label>
                  <select
                    value={channel}
                    onChange={e => setChannel(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-zinc-500"
                  >
                    {CHANNEL_OPTIONS.map(c => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                  <p className="text-[10px] text-zinc-600 mt-1">
                    Pick the channel the contact&apos;s been using. The agent must be deployed
                    on this channel or the send will fail.
                  </p>
                </div>
              )}
            </div>
          )}

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
