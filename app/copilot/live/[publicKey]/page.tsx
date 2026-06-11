'use client'

/**
 * Public Co-Pilot launch page — what the shareable link, the embed
 * button, and the JS snippet all open. No login: the publicKey in the
 * URL is the credential (published agents only). A clean, brandable
 * full-page session — screen-share permissions work because we own
 * the tab.
 */

import { use, useEffect, useMemo, useState } from 'react'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'

export default function PublicCopilotPage({ params }: { params: Promise<{ publicKey: string }> }) {
  const { publicKey } = use(params)
  const [agent, setAgent] = useState<{ name: string; type: string } | null>(null)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    void fetch(`/api/copilot/public/${publicKey}/session`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setAgent)
      .catch(() => setNotFound(true))
  }, [publicKey])

  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const res = await fetch(`/api/copilot/public/${publicKey}/session`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ locale }),
        })
        const body = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, ...body }
      },
      async tool(sessionId, name, args) {
        const res = await fetch(`/api/copilot/public/${publicKey}/session/${sessionId}?op=tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, args }),
        })
        const body = (await res.json().catch(() => ({}))) as { result?: string }
        return body.result ?? 'Tool execution failed.'
      },
      async events(sessionId, batch, final) {
        await fetch(`/api/copilot/public/${publicKey}/session/${sessionId}?op=events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
          ...(final ? { keepalive: true } : {}),
        })
      },
      async end(sessionId, reason) {
        const res = await fetch(`/api/copilot/public/${publicKey}/session/${sessionId}?op=end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endedReason: reason }),
          keepalive: true,
        })
        const body = await res.json().catch(() => ({}))
        return {
          durationSecs: typeof body.durationSecs === 'number' ? body.durationSecs : 0,
          goalReached: typeof body.resolved === 'boolean' ? body.resolved : null,
        }
      },
    }),
    [publicKey],
  )

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <p className="text-sm text-zinc-500">This co-pilot link is invalid or no longer available.</p>
      </div>
    )
  }
  if (!agent) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-zinc-700 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-zinc-100">{agent.name}</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {agent.type === 'onboarding'
              ? 'A guided session — share your screen and it will walk you through, step by step.'
              : 'Share your screen and talk it through with a live expert assistant.'}
          </p>
        </div>
        <LiveSessionPanel
          transport={transport}
          idleTitle={`Start your session with ${agent.name}`}
          idleBody="You'll be asked to share your screen and microphone. Your screen is never recorded — only the conversation transcript is kept."
          startLabel="Share screen & start talking"
          endedGoalCopy={goal =>
            goal === null ? null : goal ? '✓ All done — nice work!' : 'We didn’t quite finish — you can start again any time.'
          }
        />
      </div>
    </div>
  )
}
