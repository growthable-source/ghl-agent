'use client'

/**
 * Co-Pilot — landing page (v0 PR 1, foundation).
 *
 * This is intentionally a placeholder surface. The session API and
 * plan gate are wired; the realtime transport (LiveKit) and the
 * model provider (Gemini Live / GPT-Realtime) land in the next PR.
 *
 * What it does today:
 *   - Renders the section hero so the sidebar entry isn't a 404.
 *   - Probes POST /api/copilot/sessions on demand so we can confirm
 *     the plan gate + workspace allowlist work end-to-end inside the
 *     dogfood workspace before any vendor wiring exists.
 *   - Shows the gate state plainly. If a workspace doesn't have
 *     access, the CTA is disabled with the exact reason (plan vs.
 *     allowlist), not a generic "upgrade" wall — that's a debugging
 *     surface for us, not a billing pitch for the user.
 *
 * The "Start a session" button is intentionally inert past the
 * round-trip: the response token is the literal 'TODO_LIVEKIT' so
 * there's nothing to connect to. UI gates the button off until the
 * next PR replaces the stub with a real signed room token.
 */

import { useParams } from 'next/navigation'
import { useState } from 'react'

type ProbeState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'gated'; reason: string; status: number }
  | { kind: 'ok'; sessionId: string; token: string }
  | { kind: 'error'; message: string }

export default function CopilotLandingPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [probe, setProbe] = useState<ProbeState>({ kind: 'idle' })

  async function probeSession() {
    if (!workspaceId) return
    setProbe({ kind: 'loading' })
    try {
      const res = await fetch('/api/copilot/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId, locale: 'en-AU' }),
      })
      const body = await res.json().catch(() => ({} as Record<string, unknown>))
      if (!res.ok) {
        setProbe({
          kind: 'gated',
          reason: typeof body.error === 'string' ? body.error : `HTTP ${res.status}`,
          status: res.status,
        })
        return
      }
      setProbe({
        kind: 'ok',
        sessionId: String(body.session?.id ?? ''),
        token: String(body.token ?? ''),
      })
    } catch (err) {
      setProbe({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      {/* Hero. Brand-neutral copy — no "GHL" / "HighLevel" references,
          and "your CRM" instead of a specific vendor. */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-orange-50 text-orange-700 text-xs font-medium mb-3">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
          Preview · Foundation only
        </div>
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">Co-Pilot</h1>
        <p className="text-gray-600 leading-relaxed">
          A live screen-share advisor that watches what you&rsquo;re doing inside
          your CRM (or anywhere else) and talks you through it. Read-only in
          v0 — it guides, you click. Realtime transport ships in the next
          release; this page is the plan-gate + session-create dry run.
        </p>
      </div>

      {/* Plan-gate probe. Disabled CTA + reason banner — this is the
          debugging surface that lets us confirm the dogfood workspace
          allowlist is wired before the LiveKit work begins. */}
      <div className="rounded-xl border border-gray-200 p-6 bg-white">
        <h2 className="text-lg font-medium text-gray-900 mb-1">Session readiness check</h2>
        <p className="text-sm text-gray-600 mb-4">
          Verifies you have access to Co-Pilot in this workspace and that the
          session API responds. The returned room token is a placeholder until
          the realtime transport lands.
        </p>

        <button
          type="button"
          onClick={probeSession}
          disabled={probe.kind === 'loading'}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {probe.kind === 'loading' ? 'Checking…' : 'Check access'}
        </button>

        {probe.kind === 'gated' && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <div className="font-medium mb-0.5">Not available in this workspace</div>
            <div>{probe.reason}</div>
            <div className="mt-1 text-xs text-amber-700">
              HTTP {probe.status}. Pre-GA the COPILOT_WORKSPACE_ALLOWLIST env
              var force-enables specific workspaces; at GA this gates by plan tier.
            </div>
          </div>
        )}

        {probe.kind === 'ok' && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            <div className="font-medium mb-0.5">Session created</div>
            <div className="font-mono text-xs">id: {probe.sessionId}</div>
            <div className="font-mono text-xs">token: {probe.token}</div>
            <div className="mt-2 text-xs text-emerald-800">
              Token is a placeholder until the realtime transport ships.
              &ldquo;Start session&rdquo; stays disabled until then.
            </div>
            <button
              type="button"
              disabled
              className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gray-200 text-gray-500 font-medium cursor-not-allowed"
            >
              Start session (transport not yet wired)
            </button>
          </div>
        )}

        {probe.kind === 'error' && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            <div className="font-medium mb-0.5">Request failed</div>
            <div>{probe.message}</div>
          </div>
        )}
      </div>
    </div>
  )
}
