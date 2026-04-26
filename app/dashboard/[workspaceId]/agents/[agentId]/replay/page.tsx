'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface LogRow {
  id: string
  conversationId: string
  contactId: string
  inboundMessage: string
  outboundReply: string | null
  actionsPerformed: string[]
  status: string
  createdAt: string
}

interface ReplayResult {
  original: {
    reply: string | null
    actionsPerformed: string[]
    inbound: string
  }
  replay: {
    reply: string | null
    actionsPerformed: string[]
    toolCallTrace: Array<{ tool: string; input: Record<string, unknown>; output: string; durationMs: number }>
    durationMs: number
    tokensUsed: number
  }
}

export default function ReplayPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [logs, setLogs] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LogRow | null>(null)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [systemPromptOverride, setSystemPromptOverride] = useState('')
  const [appendInstructions, setAppendInstructions] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ReplayResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchLogs = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/replay`)
    const data = await res.json()
    setLogs(data.logs || [])
    setLoading(false)
  }, [workspaceId, agentId])

  useEffect(() => { fetchLogs() }, [fetchLogs])

  function pick(log: LogRow) {
    setSelected(log)
    setResult(null)
    setError(null)
    setOverrideOpen(false)
    setSystemPromptOverride('')
    setAppendInstructions('')
  }

  async function runReplay() {
    if (!selected) return
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageLogId: selected.id,
          overrides: {
            ...(systemPromptOverride.trim() ? { systemPrompt: systemPromptOverride } : {}),
            ...(appendInstructions.trim() ? { appendInstructions } : {}),
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Replay failed')
      } else {
        setResult(data)
      }
    } finally { setRunning(false) }
  }

  if (loading) return <div className="p-8"><div className="h-6 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Replay & Fork</h1>
        <p className="text-sm text-zinc-400 mt-1 max-w-2xl">
          Pick a past conversation, optionally override the system prompt or append a new rule, and re-run the agent in
          sandbox mode to see what it would have said. Nothing is sent or persisted — pure dry run.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6">
        {/* Left rail — past conversations */}
        <div className="space-y-2">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Recent inbounds</p>
          {logs.length === 0 ? (
            <div className="text-xs text-zinc-500 p-4 border border-dashed border-zinc-800 rounded-lg">
              No conversations yet. Once this agent processes inbounds, you can replay them here.
            </div>
          ) : (
            <div className="space-y-1 max-h-[600px] overflow-y-auto pr-1">
              {logs.map(log => (
                <button
                  key={log.id}
                  onClick={() => pick(log)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    selected?.id === log.id
                      ? 'border-orange-500/50 bg-orange-500/5'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
                  }`}
                >
                  <p className="text-[10px] text-zinc-500 mb-1">{new Date(log.createdAt).toLocaleString()}</p>
                  <p className="text-xs text-white line-clamp-2 mb-1">&ldquo;{log.inboundMessage}&rdquo;</p>
                  {log.outboundReply && (
                    <p className="text-[11px] text-zinc-400 line-clamp-2">→ {log.outboundReply}</p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right pane — replay control + diff */}
        <div className="space-y-4">
          {!selected ? (
            <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl">
              <p className="text-sm text-zinc-400 mb-1">Pick a conversation to replay</p>
              <p className="text-xs text-zinc-500">The agent will re-process the inbound with whatever overrides you set.</p>
            </div>
          ) : (
            <>
              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-1">Inbound message</p>
                <p className="text-sm text-white">&ldquo;{selected.inboundMessage}&rdquo;</p>
              </div>

              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <button
                  onClick={() => setOverrideOpen(o => !o)}
                  className="text-xs font-semibold text-zinc-300 hover:text-white flex items-center gap-2"
                >
                  <span>{overrideOpen ? '▾' : '▸'}</span>
                  Overrides ({systemPromptOverride.trim() || appendInstructions.trim() ? 'configured' : 'use current agent config'})
                </button>
                {overrideOpen && (
                  <div className="mt-3 space-y-3">
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Override system prompt (optional)</label>
                      <textarea
                        value={systemPromptOverride}
                        onChange={e => setSystemPromptOverride(e.target.value)}
                        rows={5}
                        placeholder="Leave empty to use the agent's current system prompt."
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-zinc-400 mb-1 block">Append additional instructions (optional)</label>
                      <textarea
                        value={appendInstructions}
                        onChange={e => setAppendInstructions(e.target.value)}
                        rows={3}
                        placeholder='E.g. "Always offer a Tuesday slot first." Useful for testing a candidate rule before adding it.'
                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-white"
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={runReplay}
                disabled={running}
                className="text-xs font-semibold px-5 py-2.5 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
                style={{ background: '#fa4d2e' }}
              >
                {running ? 'Replaying…' : '▶ Replay'}
              </button>

              {error && (
                <div className="p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">{error}</div>
              )}

              {result && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Original reply</p>
                    {result.original.reply ? (
                      <p className="text-sm text-zinc-200 whitespace-pre-wrap">{result.original.reply}</p>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">No reply was sent.</p>
                    )}
                    {result.original.actionsPerformed.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-800">
                        <p className="text-[10px] text-zinc-500 mb-1">Tools used</p>
                        <div className="flex flex-wrap gap-1">
                          {result.original.actionsPerformed.map((a, i) => (
                            <code key={i} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{a}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="p-4 rounded-xl border-2 border-orange-500/30 bg-orange-500/5">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[10px] text-orange-300 uppercase tracking-wider font-semibold">New reply</p>
                      <p className="text-[10px] text-zinc-500">{result.replay.durationMs}ms · {result.replay.tokensUsed} toks</p>
                    </div>
                    {result.replay.reply ? (
                      <p className="text-sm text-white whitespace-pre-wrap">{result.replay.reply}</p>
                    ) : (
                      <p className="text-xs text-zinc-500 italic">Agent did not produce a reply.</p>
                    )}
                    {result.replay.actionsPerformed.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-zinc-800">
                        <p className="text-[10px] text-zinc-500 mb-1">Tools used</p>
                        <div className="flex flex-wrap gap-1">
                          {result.replay.actionsPerformed.map((a, i) => (
                            <code key={i} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{a}</code>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
