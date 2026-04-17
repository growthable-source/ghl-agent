'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Decision {
  id: string
  createdAt: string
  contactId: string
  conversationId: string
  agent: { id: string; name: string } | null
  status: string
  inboundMessage: string
  outboundReply: string | null
  actionsPerformed: string[]
  tokensUsed: number
  toolCallTrace: any
  errorMessage: string | null
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DecisionsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [onlyActions, setOnlyActions] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/workspaces/${workspaceId}/decisions?onlyActions=${onlyActions}`)
    const data = await res.json()
    setDecisions(data.decisions || [])
    setLoading(false)
  }, [workspaceId, onlyActions])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Decision Log</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Why your agents did what they did — every tool call, every reply, full trace.
          </p>
        </div>

        <label className="flex items-center gap-2 mb-6 cursor-pointer">
          <input
            type="checkbox"
            checked={onlyActions}
            onChange={e => setOnlyActions(e.target.checked)}
            className="w-4 h-4 rounded accent-orange-500"
          />
          <span className="text-sm text-zinc-300">Only show messages with tool actions</span>
        </label>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-zinc-900/40 border border-zinc-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : decisions.length === 0 ? (
          <div className="text-center py-16 text-zinc-500 text-sm">No decisions logged yet</div>
        ) : (
          <div className="space-y-2">
            {decisions.map(d => {
              const isOpen = expanded === d.id
              return (
                <div
                  key={d.id}
                  className="border border-zinc-800 rounded-xl bg-zinc-900/40 overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : d.id)}
                    className="w-full p-4 text-left hover:bg-zinc-900/80 transition-colors"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-2">
                      {d.agent && (
                        <Link
                          href={`/dashboard/${workspaceId}/agents/${d.agent.id}`}
                          onClick={e => e.stopPropagation()}
                          className="text-sm font-semibold text-white hover:underline"
                        >
                          {d.agent.name}
                        </Link>
                      )}
                      {d.status === 'ERROR' && (
                        <span className="text-[10px] font-medium text-red-400 px-1.5 py-0.5 rounded bg-red-500/10">ERROR</span>
                      )}
                      {d.actionsPerformed?.length > 0 && (
                        <div className="flex gap-1 flex-wrap">
                          {d.actionsPerformed.map(action => (
                            <span
                              key={action}
                              className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={{ background: 'rgba(168,85,247,0.1)', color: '#a855f7' }}
                            >
                              🔧 {action.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="ml-auto text-xs text-zinc-500">{timeAgo(d.createdAt)}</span>
                    </div>
                    <p className="text-xs text-zinc-500 mb-1">
                      <span className="text-zinc-600">Contact said:</span>{' '}
                      <span className="text-zinc-300">&ldquo;{d.inboundMessage?.slice(0, 140)}&rdquo;</span>
                    </p>
                    {d.outboundReply && (
                      <p className="text-xs text-zinc-500">
                        <span className="text-zinc-600">Agent replied:</span>{' '}
                        <span className="text-zinc-300">&ldquo;{d.outboundReply.slice(0, 140)}&rdquo;</span>
                      </p>
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-zinc-800 pt-4 bg-zinc-950/40">
                      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                        <div className="p-3 rounded-lg bg-zinc-900">
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Tokens used</p>
                          <p className="text-white font-semibold">{d.tokensUsed?.toLocaleString() || 0}</p>
                        </div>
                        <div className="p-3 rounded-lg bg-zinc-900">
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Status</p>
                          <p className="text-white font-semibold">{d.status}</p>
                        </div>
                      </div>

                      {d.errorMessage && (
                        <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 mb-3">
                          <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Error</p>
                          <p className="text-xs text-red-300">{d.errorMessage}</p>
                        </div>
                      )}

                      <div className="mb-3">
                        <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Full inbound</p>
                        <p className="text-xs text-zinc-300 p-3 bg-zinc-900 rounded-lg whitespace-pre-wrap">{d.inboundMessage}</p>
                      </div>

                      {d.outboundReply && (
                        <div className="mb-3">
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Full reply</p>
                          <p className="text-xs text-zinc-300 p-3 bg-zinc-900 rounded-lg whitespace-pre-wrap">{d.outboundReply}</p>
                        </div>
                      )}

                      {d.toolCallTrace && (
                        <div>
                          <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Tool call trace</p>
                          <pre className="text-[11px] text-zinc-400 p-3 bg-zinc-900 rounded-lg overflow-x-auto font-mono">
                            {JSON.stringify(d.toolCallTrace, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
