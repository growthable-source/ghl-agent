'use client'

/**
 * Co-Pilot session history + replay.
 *
 * List comes from GET /api/copilot/sessions?workspaceId= (newest 50,
 * with the Haiku analysis surfaced per row). Expanding a row lazily
 * fetches the full replay — transcript, tool calls, analysis verdict,
 * and the auto-created ticket number when the session went
 * unresolved.
 */

import { useCallback, useEffect, useState } from 'react'

interface SessionRow {
  id: string
  mode: 'staff' | 'widget'
  status: string
  startedAt: string
  durationSecs: number | null
  endedReason: string | null
  toolCallCount: number
  summary: string | null
  issueResolved: boolean | null
  sentiment: string | null
  ticketNumber: number | null
}

interface SessionDetail {
  analysis: { summary?: string; sentiment?: string; topics?: string[] } | null
  ticket: { ticketNumber?: number } | null
  turns: Array<{ id: string; role: string; text: string | null; ts: string }>
  toolCalls: Array<{ id: string; toolName: string; latencyMs: number | null; resultSummary: string | null }>
}

function mmss(secs: number | null): string {
  if (secs == null) return '—'
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`
}

export default function PastSessions({ workspaceId, refreshKey }: { workspaceId: string; refreshKey: number }) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<SessionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/copilot/sessions?workspaceId=${workspaceId}`)
      const body = await res.json().catch(() => ({}))
      setRows(Array.isArray(body.sessions) ? body.sessions : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const toggle = useCallback(
    async (id: string) => {
      if (openId === id) {
        setOpenId(null)
        setDetail(null)
        return
      }
      setOpenId(id)
      setDetail(null)
      setDetailLoading(true)
      try {
        const res = await fetch(`/api/copilot/sessions/${id}`)
        const body = await res.json().catch(() => ({}))
        setDetail({
          analysis: body.analysis ?? null,
          ticket: body.ticket ?? null,
          turns: Array.isArray(body.turns) ? body.turns : [],
          toolCalls: Array.isArray(body.toolCalls) ? body.toolCalls : [],
        })
      } catch {
        setDetail(null)
      } finally {
        setDetailLoading(false)
      }
    },
    [openId],
  )

  if (loading) return null
  if (rows.length === 0) return null

  return (
    <div className="mt-8">
      <h2 className="text-lg font-medium text-zinc-100 mb-3">Past sessions</h2>
      <div className="rounded-xl border border-zinc-800 bg-zinc-900 divide-y divide-zinc-800 overflow-hidden">
        {rows.map(row => (
          <div key={row.id}>
            <button
              type="button"
              onClick={() => void toggle(row.id)}
              className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-zinc-800 transition"
            >
              <span
                className={`shrink-0 w-2 h-2 rounded-full ${
                  row.status === 'active'
                    ? 'bg-emerald-500 animate-pulse'
                    : row.issueResolved === false
                      ? 'bg-amber-500'
                      : 'bg-zinc-600'
                }`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-100 truncate">
                  {row.summary || (row.status === 'active' ? 'Live now' : 'No analysis yet')}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(row.startedAt).toLocaleString()} · {mmss(row.durationSecs)} ·{' '}
                  {row.mode === 'widget' ? 'visitor' : 'staff'} · {row.toolCallCount} tool call
                  {row.toolCallCount === 1 ? '' : 's'}
                </p>
              </div>
              {row.issueResolved !== null && (
                <span
                  className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded-full ${
                    row.issueResolved ? 'bg-accent-emerald-bg text-accent-emerald' : 'bg-accent-amber-bg text-accent-amber'
                  }`}
                >
                  {row.issueResolved ? 'resolved' : 'unresolved'}
                </span>
              )}
              {row.ticketNumber !== null && (
                <span className="shrink-0 text-xs font-medium px-2 py-0.5 rounded-full bg-accent-primary-bg text-accent-primary">
                  ticket #{row.ticketNumber}
                </span>
              )}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className={`shrink-0 w-4 h-4 text-zinc-500 transition-transform ${openId === row.id ? 'rotate-180' : ''}`}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {openId === row.id && (
              <div className="px-4 pb-4 bg-zinc-950 border-t border-zinc-800">
                {detailLoading && <p className="text-xs text-zinc-500 py-3">Loading replay…</p>}
                {!detailLoading && detail && (
                  <div className="pt-3 space-y-3">
                    {detail.analysis?.summary && (
                      <div className="text-sm text-zinc-300">
                        <span className="font-medium text-zinc-100">Analysis: </span>
                        {detail.analysis.summary}
                        {detail.analysis.sentiment && (
                          <span className="text-xs text-zinc-500"> · sentiment: {detail.analysis.sentiment}</span>
                        )}
                      </div>
                    )}
                    {(detail.analysis?.topics?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {detail.analysis!.topics!.map(t => (
                          <span key={t} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
                      {detail.turns.length === 0 && (
                        <p className="text-xs text-zinc-500">No transcript captured.</p>
                      )}
                      {detail.turns.map(t => (
                        <p key={t.id} className="text-sm leading-relaxed">
                          <span
                            className={`font-medium ${
                              t.role === 'user'
                                ? 'text-accent-primary'
                                : t.role === 'agent'
                                  ? 'text-zinc-100'
                                  : 'text-zinc-500'
                            }`}
                          >
                            {t.role === 'user' ? 'User' : t.role === 'agent' ? 'Co-pilot' : t.role}:
                          </span>{' '}
                          <span className={t.role === 'tool' ? 'text-zinc-500 text-xs' : 'text-zinc-300'}>
                            {t.text}
                          </span>
                        </p>
                      ))}
                    </div>
                    {detail.toolCalls.length > 0 && (
                      <div className="text-xs text-zinc-500">
                        Tools: {detail.toolCalls.map(c => `${c.toolName} (${c.latencyMs ?? '?'}ms)`).join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
