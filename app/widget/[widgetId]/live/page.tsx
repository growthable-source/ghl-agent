'use client'

/**
 * Widget live-help page — visitor-facing Co-Pilot session.
 *
 * Opened in a NEW TAB from the chat widget's "Live help" button
 * (?pk=<publicKey>&cid=<cookieId>, same query auth as /call). A full
 * top-level page rather than the widget iframe because screen-share
 * permission prompts inside cross-origin iframes depend on each
 * customer site's iframe allow-list — a tab we own always works.
 *
 * Same LiveSessionPanel as the dashboard, with the widget transport
 * (publicKey auth, op-multiplexed session endpoints) and the
 * widget's brand color.
 */

import { use, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'

interface WidgetConfig {
  title: string
  subtitle: string
  primaryColor: string
  logoUrl: string | null
}

export default function WidgetLivePage({ params }: { params: Promise<{ widgetId: string }> }) {
  const { widgetId } = use(params)
  const search = useSearchParams()
  const publicKey = search?.get('pk') ?? ''
  const cookieId = search?.get('cid') ?? ''

  const [config, setConfig] = useState<WidgetConfig | null>(null)
  const [configError, setConfigError] = useState(false)

  useEffect(() => {
    if (!publicKey) {
      setConfigError(true)
      return
    }
    void fetch(`/api/widget/${widgetId}/config?pk=${encodeURIComponent(publicKey)}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((c: WidgetConfig) => setConfig(c))
      .catch(() => setConfigError(true))
  }, [widgetId, publicKey])

  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const res = await fetch(`/api/widget/${widgetId}/copilot/session?pk=${encodeURIComponent(publicKey)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookieId, locale }),
        })
        const body = await res.json().catch(() => ({}))
        return { ok: res.ok, status: res.status, ...body }
      },
      async tool(sessionId, name, args) {
        const res = await fetch(
          `/api/widget/${widgetId}/copilot/session/${sessionId}?op=tool&pk=${encodeURIComponent(publicKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, args }),
          },
        )
        const body = (await res.json().catch(() => ({}))) as { result?: string }
        return body.result ?? 'Tool execution failed.'
      },
      async events(sessionId, batch, final) {
        await fetch(
          `/api/widget/${widgetId}/copilot/session/${sessionId}?op=events&pk=${encodeURIComponent(publicKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(batch),
            ...(final ? { keepalive: true } : {}),
          },
        )
      },
      async end(sessionId, reason) {
        const res = await fetch(
          `/api/widget/${widgetId}/copilot/session/${sessionId}?op=end&pk=${encodeURIComponent(publicKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endedReason: reason }),
            keepalive: true,
          },
        )
        const body = await res.json().catch(() => ({}))
        return {
          durationSecs: typeof body.durationSecs === 'number' ? body.durationSecs : 0,
          goalReached: typeof body.resolved === 'boolean' ? body.resolved : null,
        }
      },
    }),
    [widgetId, publicKey, cookieId],
  )

  if (configError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-6">
        <p className="text-sm text-gray-500">This live-help link is invalid or has expired.</p>
      </div>
    )
  }
  if (!config) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-8 h-8 border-2 border-gray-300 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const accent = config.primaryColor || '#fa4d2e'

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center gap-3 mb-6">
          {config.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={config.logoUrl} alt="" className="w-10 h-10 rounded-full object-cover" />
          ) : (
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-base font-bold text-white"
              style={{ background: accent }}
            >
              {config.title.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <h1 className="text-xl font-semibold text-gray-900">{config.title} — Live help</h1>
            <p className="text-sm text-gray-500">
              Share your screen and talk it through with our expert assistant.
            </p>
          </div>
        </div>

        <LiveSessionPanel
          transport={transport}
          accent={accent}
          idleTitle="Get live help on a screen share"
          idleBody="Share your screen and ask anything — the assistant can see what you see and talks you through it step by step. Your screen is never recorded; only the conversation transcript is kept so our team can follow up."
          startLabel="Share screen & start talking"
          endedGoalCopy={goal =>
            goal === null
              ? null
              : goal
                ? '✓ Glad we could help!'
                : 'We couldn’t fully solve this live — our team has been notified and will follow up.'
          }
        />
      </div>
    </div>
  )
}
