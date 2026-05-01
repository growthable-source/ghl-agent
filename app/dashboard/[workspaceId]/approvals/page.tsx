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
  judgeVerdict?: 'safe' | 'unsafe' | 'uncertain' | null
  judgeReason?: string | null
  judgeModel?: string | null
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
  const [judgeConfigOpen, setJudgeConfigOpen] = useState(false)

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
        <div className="mb-8 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Approval Queue</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Messages your agents flagged for human review before sending.
            </p>
          </div>
          <button
            onClick={() => setJudgeConfigOpen(true)}
            className="text-xs font-semibold px-4 py-2 rounded-lg hover:opacity-90 transition-colors"
            style={{ background: 'var(--accent-primary)', color: '#fff' }}
          >
            🤖 AI Judge settings
          </button>
        </div>
        {judgeConfigOpen && (
          <JudgeConfigModal
            workspaceId={workspaceId}
            onClose={() => setJudgeConfigOpen(false)}
          />
        )}

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
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Inbox zero</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>No messages waiting for approval.</p>
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
                          className="text-sm font-semibold hover:underline"
                          style={{ color: 'var(--text-primary)' }}
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
                      {log.judgeVerdict && (
                        <span
                          title={log.judgeReason || ''}
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full cursor-help"
                          style={{
                            background: log.judgeVerdict === 'safe' ? 'rgba(34,197,94,0.12)'
                              : log.judgeVerdict === 'unsafe' ? 'rgba(239,68,68,0.12)'
                              : 'rgba(99,102,241,0.12)',
                            color: log.judgeVerdict === 'safe' ? '#4ade80'
                              : log.judgeVerdict === 'unsafe' ? '#f87171'
                              : '#a5b4fc',
                          }}
                        >
                          🤖 judge: {log.judgeVerdict}
                        </span>
                      )}
                      <span className="ml-auto text-xs text-zinc-500">{timeAgo(log.createdAt)}</span>
                    </div>
                    {log.judgeReason && (
                      <p className="text-[11px] text-zinc-500 italic mb-2 -mt-1">Judge: {log.judgeReason}</p>
                    )}

                    {/* Contact message */}
                    <div className="p-3 rounded-lg mb-2" style={{ background: 'var(--surface-secondary)' }}>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Contact said</p>
                      <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{log.inboundMessage}</p>
                    </div>

                    {/* Drafted reply */}
                    <div className="p-3 rounded-lg mb-3" style={{ background: 'var(--surface-secondary)' }}>
                      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>Agent drafted</p>
                      {isEditing ? (
                        <textarea
                          value={editText}
                          onChange={e => setEditText(e.target.value)}
                          rows={4}
                          className="w-full rounded px-2 py-1.5 text-xs"
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                        />
                      ) : (
                        <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{log.outboundReply}</p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => decide(log.id, 'approve', editText)}
                            disabled={busy === log.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
                            style={{ background: 'var(--accent-emerald)', color: '#fff' }}
                          >
                            Send edited reply
                          </button>
                          <button
                            onClick={() => setEditing(null)}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-secondary)' }}
                          >
                            Cancel edit
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => decide(log.id, 'approve')}
                            disabled={busy === log.id}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors hover:opacity-90"
                            style={{ background: 'var(--accent-emerald)', color: '#fff' }}
                          >
                            Approve & send
                          </button>
                          <button
                            onClick={() => { setEditing(log.id); setEditText(log.outboundReply || '') }}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            style={{ border: '1px solid var(--border-secondary)', color: 'var(--text-secondary)' }}
                          >
                            Edit & send
                          </button>
                          <button
                            onClick={() => decide(log.id, 'reject')}
                            disabled={busy === log.id}
                            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--accent-red)' }}
                          >
                            Reject
                          </button>
                          <Link
                            href={`/dashboard/${workspaceId}/contacts/${log.contactId}`}
                            className="ml-auto text-[11px] transition-colors"
                            style={{ color: 'var(--text-tertiary)' }}
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

interface AgentJudgeConfig {
  id: string
  name: string
  requireApproval: boolean
  judgeEnabled: boolean
  judgeModel: 'haiku' | 'sonnet'
  judgeAutoSend: boolean
  judgeAutoBlock: boolean
  judgeInstructions: string | null
}

function JudgeConfigModal({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const [agents, setAgents] = useState<AgentJudgeConfig[] | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents`)
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error)
        else setAgents(d.agents || [])
      })
      .catch(e => setError(e?.message || 'Could not load agents'))
  }, [workspaceId])

  async function update(agentId: string, patch: Partial<AgentJudgeConfig>) {
    setSaving(agentId)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || `Save failed (HTTP ${res.status})`)
        return
      }
      // Server may have warned that judge migration is pending — surface it.
      if (data.warning) setError(data.warning)
      setAgents(prev => prev?.map(a => a.id === agentId ? { ...a, ...patch } as AgentJudgeConfig : a) || null)
    } catch (err: any) {
      setError(err?.message || 'Network error')
    } finally { setSaving(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
        <div className="p-6 flex items-start justify-between shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>🤖 AI Judge settings</h2>
            <p className="text-xs mt-1 max-w-xl" style={{ color: 'var(--text-tertiary)' }}>
              When approval rules flag a message, run a cheap LLM pass first. SAFE → auto-release; UNSAFE → optionally
              auto-block; UNCERTAIN → keep for human review. Cuts queue volume ~80% on the typical mix.
            </p>
          </div>
          <button onClick={onClose} className="text-xl leading-none" style={{ color: 'var(--text-tertiary)' }}>×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {error && (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 text-xs text-amber-300">
              {error}
            </div>
          )}
          {agents === null ? (
            <div className="h-6 w-32 bg-zinc-800 rounded animate-pulse" />
          ) : agents.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>No agents in this workspace.</p>
          ) : (
            agents.map(a => (
              <div
                key={a.id}
                className="p-4 rounded-xl"
                style={a.judgeEnabled
                  ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                  : { border: '1px solid var(--border)', background: 'var(--surface-secondary)' }}
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{a.name}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>
                      {a.requireApproval
                        ? `Approval queue is on. Judge ${a.judgeEnabled ? 'will pre-screen' : 'is off — every flagged message goes to a human'}.`
                        : 'Approval queue is off — turn it on at the agent level first; the judge only runs on flagged messages.'}
                    </p>
                  </div>
                  <button
                    onClick={() => update(a.id, { judgeEnabled: !a.judgeEnabled })}
                    disabled={saving === a.id || !a.requireApproval}
                    className="relative inline-flex h-5 w-9 items-center rounded-full disabled:opacity-30"
                    style={{ background: a.judgeEnabled ? 'var(--accent-primary)' : 'var(--surface-tertiary)' }}
                  >
                    <span className="inline-block h-3 w-3 rounded-full bg-white transition-transform"
                      style={{ transform: a.judgeEnabled ? 'translateX(20px)' : 'translateX(4px)' }} />
                  </button>
                </div>

                {a.judgeEnabled && (
                  <div className="space-y-3 mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        <span className="block mb-1">Judge model</span>
                        <select
                          value={a.judgeModel}
                          onChange={e => update(a.id, { judgeModel: e.target.value as any })}
                          className="w-full rounded px-2 py-1.5 text-xs"
                          style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                        >
                          <option value="haiku">Haiku (fast, cheap)</option>
                          <option value="sonnet">Sonnet (slower, more nuance)</option>
                        </select>
                      </label>
                    </div>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={a.judgeAutoSend}
                        onChange={e => update(a.id, { judgeAutoSend: e.target.checked })}
                        className="mt-0.5 w-4 h-4 accent-orange-500"
                      />
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-primary)' }}>Auto-release messages judged SAFE</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Off = even SAFE verdicts wait for a human to click approve.</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={a.judgeAutoBlock}
                        onChange={e => update(a.id, { judgeAutoBlock: e.target.checked })}
                        className="mt-0.5 w-4 h-4 accent-orange-500"
                      />
                      <div>
                        <p className="text-xs" style={{ color: 'var(--text-primary)' }}>Auto-reject messages judged UNSAFE</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>Off = UNSAFE verdicts still surface to a human (recommended at first).</p>
                      </div>
                    </label>
                    <div>
                      <label className="text-[11px] block mb-1" style={{ color: 'var(--text-secondary)' }}>Custom rubric (optional)</label>
                      <textarea
                        value={a.judgeInstructions || ''}
                        onChange={e => update(a.id, { judgeInstructions: e.target.value })}
                        rows={3}
                        placeholder='E.g. "Never auto-send anything that quotes a price. Auto-send anything that is just confirming a meeting time."'
                        className="w-full rounded px-2 py-1.5 text-xs"
                        style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', color: 'var(--input-text)' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
