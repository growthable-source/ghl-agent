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

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import LiveSessionPanel, { type CopilotTransport } from '@/components/copilot/LiveSessionPanel'
import PastSessions from '@/components/copilot/PastSessions'

export default function CopilotPage() {
  const params = useParams<{ workspaceId: string }>()
  const workspaceId = params?.workspaceId
  const [refreshKey, setRefreshKey] = useState(0)
  const [mode, setMode] = useState<'general' | 'onboarding' | 'sop'>('general')
  const [sops, setSops] = useState<Array<{ id: string; title: string; timeboxMinutes: number }>>([])
  const [sopId, setSopId] = useState<string>('')
  const [showSopForm, setShowSopForm] = useState(false)
  const [sopDraft, setSopDraft] = useState({ title: '', minutes: '20', steps: '' })

  useEffect(() => {
    if (!workspaceId) return
    void fetch(`/api/workspaces/${workspaceId}/copilot/sops`)
      .then(r => (r.ok ? r.json() : { sops: [] }))
      .then(d => setSops(Array.isArray(d.sops) ? d.sops : []))
      .catch(() => setSops([]))
  }, [workspaceId, refreshKey])

  const createSop = useCallback(async () => {
    const steps = sopDraft.steps.split('\n').map(s => s.trim()).filter(Boolean)
    if (!sopDraft.title.trim() || steps.length === 0) return
    const res = await fetch(`/api/workspaces/${workspaceId}/copilot/sops`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: sopDraft.title, goal: sopDraft.title, timeboxMinutes: Number(sopDraft.minutes) || 20, steps }),
    })
    const body = await res.json().catch(() => ({}))
    if (res.ok && body.sop) {
      setSops(prev => [body.sop, ...prev])
      setSopId(body.sop.id)
      setMode('sop')
      setShowSopForm(false)
      setSopDraft({ title: '', minutes: '20', steps: '' })
    }
  }, [workspaceId, sopDraft])

  const transport = useMemo<CopilotTransport>(
    () => ({
      async create(locale) {
        const res = await fetch('/api/copilot/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId, locale, mode, sopId: mode === 'sop' ? sopId : undefined }),
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
    [workspaceId, mode, sopId],
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

      {/* Session type — what kind of co-pilot answers this session. */}
      <div className="mb-4 flex items-center gap-2 flex-wrap">
        {([
          { key: 'general', label: 'General support', hint: 'Fix anything — diagnose and solve whatever comes up' },
          { key: 'onboarding', label: 'Guided onboarding', hint: 'Walks the built-in publish-your-first-agent workflow' },
          { key: 'sop', label: 'Run a procedure', hint: 'Follow one of your SOPs step-by-step inside a timebox' },
        ] as const).map(m => (
          <button
            key={m.key}
            type="button"
            title={m.hint}
            onClick={() => setMode(m.key)}
            className={`px-3.5 py-2 rounded-lg text-sm font-medium border transition-colors ${
              mode === m.key
                ? 'border-transparent text-white'
                : 'border-zinc-700 text-zinc-400 hover:bg-zinc-800'
            }`}
            style={mode === m.key ? { background: 'var(--accent-primary)' } : undefined}
          >
            {m.label}
          </button>
        ))}
        {mode === 'sop' && (
          <>
            <select
              value={sopId}
              onChange={e => setSopId(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-2 text-sm text-zinc-300 focus:outline-none"
            >
              <option value="">Pick a procedure…</option>
              {sops.map(s => (
                <option key={s.id} value={s.id}>
                  {s.title} ({s.timeboxMinutes} min)
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowSopForm(v => !v)}
              className="px-3 py-2 rounded-lg text-sm text-zinc-400 border border-zinc-700 hover:bg-zinc-800 transition-colors"
            >
              + New procedure
            </button>
          </>
        )}
      </div>

      {mode === 'sop' && showSopForm && (
        <div className="mb-4 rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-2">
          <div className="flex gap-2 flex-wrap">
            <input
              value={sopDraft.title}
              onChange={e => setSopDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="Procedure name (e.g. New client onboarding)"
              className="flex-1 min-w-[220px] bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
            <input
              value={sopDraft.minutes}
              onChange={e => setSopDraft(d => ({ ...d, minutes: e.target.value }))}
              placeholder="Minutes"
              className="w-24 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
          </div>
          <textarea
            value={sopDraft.steps}
            onChange={e => setSopDraft(d => ({ ...d, steps: e.target.value }))}
            placeholder={'One step per line, e.g.\nConnect the CRM location\nImport the contact list\nDeploy the SMS channel'}
            rows={5}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void createSop()}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white transition hover:opacity-90"
            style={{ background: 'var(--accent-primary)' }}
          >
            Save procedure
          </button>
        </div>
      )}

      <LiveSessionPanel
        key={`${mode}:${sopId}`}
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
