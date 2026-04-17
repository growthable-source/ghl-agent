'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface ApprovalLog {
  id: string
  createdAt: string
  approvedAt: string | null
  contactId: string
  conversationId: string
  agent: { id: string; name: string } | null
  inboundMessage: string
  outboundReply: string | null
  approvalStatus: string | null
  approvalReason: string | null
  approvedBy: string | null
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

const REASON_LABELS: Record<string, string> = {
  low_sentiment: 'Low sentiment detected',
  first_contact: 'First contact with this person',
  high_value: 'High-value opportunity',
  long_message: 'Unusually long response',
  refund_mention: 'Refund or complaint keywords',
}

export default function ApprovalsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [pending, setPending] = useState<ApprovalLog[]>([])
  const [recent, setRecent] = useState<ApprovalLog[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [notMigrated, setNotMigrated] = useState(false)

  const fetchData = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/approvals`)
    const data = await res.json()
    setPending(data.pending || [])
    setRecent(data.recentDecided || [])
    setNotMigrated(!!data.notMigrated)
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchData() }, [fetchData])
  useEffect(() => {
    const i = setInterval(fetchData, 15000) // 15s polling
    return () => clearInterval(i)
  }, [fetchData])

  async function decide(id: string, action: 'approve' | 'reject', editedReply?: string) {
    setBusy(id)
    try {
      await fetch(`/api/workspaces/${workspaceId}/approvals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, editedReply }),
      })
      setPending(prev => prev.filter(p => p.id !== id))
      setEditing(null)
    } finally { setBusy(null) }
  }

  if (loading) return <div className="flex-1 p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Approval Queue</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Messages your agents flagged for human review before sending.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-medium">Migration pending</p>
            <p className="text-xs text-amber-300/70 mt-1">
              Run manual_symbiosis_migration.sql to enable the approval queue.
            </p>
          </div>
        )}

        {/* Pending */}
        <div className="mb-10">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
            Pending ({pending.length})
          </h2>

          {pending.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
              <div className="w-12 h-12 mb-3 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-medium text-white">Inbox zero</p>
              <p className="text-xs text-zinc-500 mt-1">No messages waiting for approval.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pending.map(log => {
                const isEditing = editing === log.id
                return (
                  <div
                    key={log.id}
                    className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5"
                  >
                    <div className="flex items-center gap-2 mb-3 flex-wrap">
                      {log.agent && (
                        <Link
                          href={`/dashboard/${workspaceId}/agents/${log.agent.id}`}
                          className="text-sm font-semibold text-white hover:underline"
                        >
                          {log.agent.name}
                        </Link>
                      )}
                      {log.approvalReason && (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                          style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24' }}
                        >
                          {REASON_LABELS[log.approvalReason] || log.approvalReason}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-zinc-500">{timeAgo(log.createdAt)}</span>
                    </div>

                    {/* Contact message */}
                    <div className="p-3 rounded-lg bg-zinc-900 mb-2">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Contact said</p>
                      <p className="text-xs text-zinc-300 whitespace-pre-wrap">{log.inboundMessage}</p>
                    </div>

                    {/* Drafted reply */}
                    <div className="p-3 rounded-lg bg-zinc-900 mb-3">
                      <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Agent drafted</p>
                      {isEditing ? (
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={4}
                          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-300"
                        />
                      ) : (
                        <p className="text-xs text-zinc-300 whitespace-pre-wrap">{log.outboundReply}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => decide(log.id, 'approve', editText)}
                            disabled={busy === log.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors"
                            style={{ background: '#22c55e' }}
                          >
                            Send edited reply
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg text-zinc-400 hover:text-white transition-colors"
                          >
                            Cancel edit
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => decide(log.id, 'approve')}
                            disabled={busy === log.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-colors hover:opacity-90"
                            style={{ background: '#22c55e' }}
                          >
                            Approve & send
                          </button>
                          <button
                            onClick={() => { setEditing(log.id); setEditText(log.outboundReply || '') }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-600 transition-colors"
                          >
                            Edit & send
                          </button>
                          <button
                            onClick={() => decide(log.id, 'reject')}
                            disabled={busy === log.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg text-red-400 hover:bg-red-500/10 transition-colors"
                          >
                            Reject
                          </button>
                          <Link
                            href={`/dashboard/${workspaceId}/contacts/${log.contactId}`}
                            className="ml-auto text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            View contact →
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Recent decisions */}
        {recent.length > 0 && (
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
              Recently decided
            </h2>
            <div className="space-y-1">
              {recent.map(log => (
                <div key={log.id} className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/20">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    log.approvalStatus === 'approved'
                      ? 'bg-emerald-500/10 text-emerald-400'
                      : 'bg-red-500/10 text-red-400'
                  }`}>
                    {log.approvalStatus}
                  </span>
                  <span className="text-xs text-zinc-400 flex-1 truncate">
                    {log.agent?.name} · &ldquo;{log.outboundReply?.slice(0, 80)}&rdquo;
                  </span>
                  <span className="text-[10px] text-zinc-600">{log.approvedAt && timeAgo(log.approvedAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
