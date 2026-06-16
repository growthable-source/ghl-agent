'use client'

import { useEffect, useState } from 'react'

/**
 * "Send the demo agent into my Google Meet" launcher for the homepage.
 * Renders its own trigger button + a modal that POSTs to the public demo
 * meeting endpoint, polls status, shows the 10-minute countdown, and can
 * pull the bot out early. Matches the shipped contract at
 * /api/copilot/public/[publicKey]/meeting.
 */
export default function MeetingDemoModal({
  publicKey,
  triggerClassName = 'btn-secondary',
  triggerLabel = 'Send it into my Meet',
}: {
  publicKey: string
  triggerClassName?: string
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [phase, setPhase] = useState<'idle' | 'sending' | 'live'>('idle')
  const [status, setStatus] = useState('')
  const [remaining, setRemaining] = useState<number | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState('')

  // Poll bot/session status while a demo is live.
  useEffect(() => {
    if (phase !== 'live' || !sessionId) return
    const i = setInterval(async () => {
      try {
        const res = await fetch(`/api/copilot/public/${publicKey}/meeting?sessionId=${sessionId}`)
        if (!res.ok) return
        const b = await res.json()
        setStatus(b.statusLabel || '')
        if (typeof b.remainingSecs === 'number') setRemaining(b.remainingSecs)
        if (b.sessionStatus !== 'active') {
          setPhase('idle')
          setStatus('Demo ended')
          setSessionId(null)
        }
      } catch {
        /* transient — keep last status */
      }
    }, 5000)
    return () => clearInterval(i)
  }, [phase, sessionId, publicKey])

  async function launch() {
    if (!meetingUrl.trim() || phase === 'sending') return
    setPhase('sending')
    setError('')
    try {
      const res = await fetch(`/api/copilot/public/${publicKey}/meeting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meetingUrl: meetingUrl.trim() }),
      })
      const b = await res.json().catch(() => ({}))
      if (res.ok) {
        setSessionId(b.sessionId)
        setStatus(b.statusLabel || 'Joining the meeting…')
        setPhase('live')
      } else {
        setPhase('idle')
        setError(b.error || 'Could not start the demo right now.')
      }
    } catch {
      setPhase('idle')
      setError('Could not start the demo right now.')
    }
  }

  async function stop() {
    if (sessionId) {
      await fetch(`/api/copilot/public/${publicKey}/meeting?sessionId=${sessionId}`, { method: 'DELETE' }).catch(() => {})
    }
    setPhase('idle')
    setSessionId(null)
    setStatus('')
    setRemaining(null)
  }

  const mmss =
    remaining != null
      ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
      : null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={triggerClassName}>
        {triggerLabel}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={() => setOpen(false)}
        >
          <div className="vox-card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4 mb-1">
              <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                Send the agent into your meeting
              </h3>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="shrink-0 opacity-70 hover:opacity-100"
                style={{ color: 'var(--text-secondary)' }}
              >
                ✕
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
              Paste a Google Meet, Zoom, or Teams link. Harry joins as a participant for up to 10 minutes — admit him from
              inside the call.
            </p>

            {phase === 'live' ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-primary)' }}>
                  <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent-emerald)' }} />
                  {status || 'In the call'}
                  {mmss && (
                    <span className="ml-auto tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                      {mmss} left
                    </span>
                  )}
                </div>
                <button type="button" onClick={stop} className="btn-secondary w-full">
                  Stop the demo
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  placeholder="https://meet.google.com/abc-defg-hij"
                  className="w-full rounded-lg px-4 py-3 text-sm outline-none"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                />
                {error && (
                  <p className="text-xs" style={{ color: 'var(--accent-red)' }}>
                    {error}
                  </p>
                )}
                <button
                  type="button"
                  onClick={launch}
                  disabled={!meetingUrl.trim() || phase === 'sending'}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {phase === 'sending' ? 'Sending the agent…' : 'Send the agent in'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
