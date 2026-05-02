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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Decision Log</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
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
          <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>Only show messages with tool actions</span>
        </label>

        {loading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 rounded-xl animate-pulse" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }} />
            ))}
          </div>
        ) : decisions.length === 0 ? (
          <div className="text-center py-16 text-sm" style={{ color: 'var(--text-muted)' }}>No decisions logged yet</div>
        ) : (
          <div className="space-y-2">
            {decisions.map(d => {
              const isOpen = expanded === d.id
              return (
                <div
                  key={d.id}
                  className="rounded-xl overflow-hidden"
                  style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
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
                          className="text-sm font-semibold hover:underline"
                          style={{ color: 'var(--text-primary)' }}
                        >
                          {d.agent.name}
                        </Link>
                      )}
                      {d.status === 'ERROR' && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ color: 'var(--accent-red)', background: 'var(--accent-red-bg)' }}>ERROR</span>
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
                      <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(d.createdAt)}</span>
                    </div>
                    <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                      <span style={{ color: 'var(--text-muted)' }}>Contact said:</span>{' '}
                      <span style={{ color: 'var(--text-secondary)' }}>&ldquo;{d.inboundMessage?.slice(0, 140)}&rdquo;</span>
                    </p>
                    {d.outboundReply && (
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        <span style={{ color: 'var(--text-muted)' }}>Agent replied:</span>{' '}
                        <span style={{ color: 'var(--text-secondary)' }}>&ldquo;{d.outboundReply.slice(0, 140)}&rdquo;</span>
                      </p>
                    )}
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-4" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-secondary)' }}>
                      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
                        <div className="p-3 rounded-lg" style={{ background: 'var(--surface-tertiary)' }}>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tokens used</p>
                          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.tokensUsed?.toLocaleString() || 0}</p>
                        </div>
                        <div className="p-3 rounded-lg" style={{ background: 'var(--surface-tertiary)' }}>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Status</p>
                          <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{d.status}</p>
                        </div>
                      </div>

                      {d.errorMessage && (
                        <div className="p-3 rounded-lg mb-3" style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red-bg)' }}>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--accent-red)' }}>Error</p>
                          <p className="text-xs" style={{ color: 'var(--accent-red)' }}>{d.errorMessage}</p>
                        </div>
                      )}

                      <div className="mb-3">
                        <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Full inbound</p>
                        <p className="text-xs p-3 rounded-lg whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', background: 'var(--surface-tertiary)' }}>{d.inboundMessage}</p>
                      </div>

                      {d.outboundReply && (
                        <div className="mb-3">
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Full reply</p>
                          <p className="text-xs p-3 rounded-lg whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', background: 'var(--surface-tertiary)' }}>{d.outboundReply}</p>
                        </div>
                      )}

                      {d.toolCallTrace && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Tool call trace</p>
                          <pre className="text-[11px] p-3 rounded-lg overflow-x-auto font-mono" style={{ color: 'var(--text-tertiary)', background: 'var(--surface-tertiary)' }}>
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
