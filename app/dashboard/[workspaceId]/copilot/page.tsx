'use client'

/**
 * Co-Pilot — dashboard surface (staff).
 *
 * Thin host around the shared LiveSessionPanel: supplies the
 * staff-route transport (NextAuth-cookie'd /api/copilot/* endpoints)
 * plus the session history below. The widget visitor surface reuses
 * the same panel with its own transport — see
 * app/widget/[widgetId]/live/page.tsx.
 */

import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'
import PastSessions from '@/components/copilot/PastSessions'

export default function CopilotPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [refreshKey, setRefreshKey] = useState(0)

  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const res = await fetch('/api/copilot/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, locale }),
        })
        const body = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, ...body }
      },
      async tool(sessionId, name, args) {
        const res = await fetch(`/api/copilot/sessions/${sessionId}/tool`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, args }),
        })
        const body = (await res.json().catch(() => ({}))) as { result?: string }
        return body.result ?? 'Tool execution failed.'
      },
      async events(sessionId, batch, final) {
        await fetch(`/api/copilot/sessions/${sessionId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(batch),
          ...(final ? { keepalive: true } : {}),
        })
      },
      async end(sessionId, reason) {
        const res = await fetch(`/api/copilot/sessions/${sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endedReason: reason }),
          keepalive: true,
        })
        const body = await res.json().catch(() => ({}))
        return {
          durationSecs: typeof body.durationSecs === 'number' ? body.durationSecs : 0,
          goalReached: typeof body.taskSuccess === 'boolean' ? body.taskSuccess : null,
        }
      },
    }),
    [workspaceId],
  )

  const onSessionEnded = useCallback(() => setRefreshKey(k => k + 1), [])

  if (!workspaceId) return null

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-semibold text-zinc-100 mb-2">Co-Pilot</h1>
        <p className="text-zinc-400 leading-relaxed max-w-2xl">
          Share your screen and talk — the co-pilot watches what you&rsquo;re doing and walks you
          through setup in real time. It guides, you click: it can&rsquo;t change anything itself.
        </p>
      </div>

      <LiveSessionPanel
        transport={transport}
        endedGoalCopy={goal =>
          goal === null
            ? null
            : goal
              ? '✓ Setup goal reached during this session'
              : 'Setup goal not reached yet — pick up where you left off any time'
        }
        onSessionEnded={onSessionEnded}
      />

      <PastSessions workspaceId={workspaceId} refreshKey={refreshKey} />
    </div>
  )
}
