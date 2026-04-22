'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface LearningData {
  id: string
  status: string
  scope: string
  type: string
  title: string
  content: string
  rationale: string | null
  agentId: string | null
  agentName: string | null
  workspaceId: string | null
  workspaceName: string
  proposedByEmail: string
  approvedByEmail: string | null
  rejectedByEmail: string | null
  rejectedReason: string | null
  appliedAt: string | null
  createdAt: string
  sourceReviewId: string | null
  sourceContactId: string | null
}

function scopeStyle(scope: string): string {
  // Visual weight escalates with blast radius — a bright tint on
  // all_agents is the point, so approvers don't nod through a global
  // without noticing.
  if (scope === 'all_agents') return 'text-purple-300 bg-purple-500/15 border-purple-500/40'
  if (scope === 'workspace') return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
  return 'text-zinc-400 bg-zinc-900 border-zinc-800'
}

interface Props {
  learning: LearningData
}

/**
 * One card in the platform-learnings queue. Exposes approve / reject /
 * apply / retire buttons gated by the current status. On approve, the
 * admin can edit the wording inline before confirming — the backing
 * endpoint accepts an optional `content` override for exactly that.
 */
export default function LearningRow({ learning }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState<null | 'approve' | 'reject' | 'apply' | 'retire'>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draftContent, setDraftContent] = useState(learning.content)
  const [rejectReason, setRejectReason] = useState('')
  const [askingReject, setAskingReject] = useState(false)

  async function perform(action: 'approve' | 'reject' | 'apply' | 'retire', extra?: Record<string, unknown>) {
    setBusy(action)
    setError(null)
    try {
      const res = await fetch(`/api/admin/learnings/${learning.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...(extra ?? {}) }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      setEditing(false)
      setAskingReject(false)
      router.refresh()
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const statusStyle =
    learning.status === 'proposed' ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' :
    learning.status === 'approved' ? 'text-blue-400 bg-blue-500/10 border-blue-500/30' :
    learning.status === 'applied' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
    learning.status === 'rejected' ? 'text-zinc-500 bg-zinc-800 border-zinc-700 line-through' :
    learning.status === 'retired' ? 'text-zinc-500 bg-zinc-800 border-zinc-700' :
    'text-zinc-500 bg-zinc-900 border-zinc-800'

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${statusStyle}`}>
              {learning.status}
            </span>
            <span className={`text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded border ${scopeStyle(learning.scope)}`}>
              {learning.scope.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-900 text-zinc-500 border border-zinc-800">
              {learning.type.replace(/_/g, ' ')}
            </span>
            <h3 className="text-sm text-zinc-100 font-medium">{learning.title}</h3>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            {learning.scope === 'all_agents' ? (
              <span className="text-purple-300">applies to every agent on the platform</span>
            ) : learning.scope === 'workspace' ? (
              <>applies to every agent in <span className="text-cyan-300">{learning.workspaceName}</span></>
            ) : learning.agentName ? (
              <>Agent <span className="text-zinc-400">{learning.agentName}</span></>
            ) : (
              <em className="text-zinc-600">agent deleted</em>
            )}
            {learning.scope !== 'all_agents' && (
              <>{' · '}workspace <span className="text-zinc-400">{learning.workspaceName}</span></>
            )}
            {' · '}proposed by <span className="font-mono text-zinc-500">{learning.proposedByEmail}</span>
            {' · '}<span className="font-mono text-zinc-600">{new Date(learning.createdAt).toISOString().slice(0, 16).replace('T', ' ')}</span>
          </p>
        </div>
        {learning.sourceReviewId && learning.agentId && learning.sourceContactId && (
          <Link
            href={`/admin/conversations/${learning.agentId}/${learning.sourceContactId}`}
            className="text-[11px] text-blue-400 hover:text-blue-300 shrink-0"
          >
            View source conversation →
          </Link>
        )}
      </div>

      {learning.rationale && (
        <p className="text-xs text-zinc-400 italic">{learning.rationale}</p>
      )}

      {editing ? (
        <textarea
          value={draftContent}
          onChange={e => setDraftContent(e.target.value)}
          rows={4}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-600"
        />
      ) : (
        <pre className="text-xs text-zinc-300 whitespace-pre-wrap bg-zinc-900/50 p-3 rounded border border-zinc-800 font-sans">
          {learning.content}
        </pre>
      )}

      {(learning.approvedByEmail || learning.rejectedByEmail || learning.appliedAt) && (
        <div className="text-[10px] text-zinc-500 font-mono space-x-3">
          {learning.approvedByEmail && <span>approved by {learning.approvedByEmail}</span>}
          {learning.appliedAt && <span>applied {new Date(learning.appliedAt).toISOString().slice(0, 16).replace('T', ' ')}</span>}
          {learning.rejectedByEmail && (
            <span>
              rejected by {learning.rejectedByEmail}
              {learning.rejectedReason ? ` — "${learning.rejectedReason}"` : ''}
            </span>
          )}
        </div>
      )}

      {askingReject && (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={rejectReason}
            onChange={e => setRejectReason(e.target.value)}
            placeholder="Reason (optional)"
            className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={() => perform('reject', { reason: rejectReason })}
            disabled={busy !== null}
            className="text-xs font-medium text-red-300 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {busy === 'reject' ? 'Rejecting…' : 'Confirm reject'}
          </button>
          <button
            type="button"
            onClick={() => setAskingReject(false)}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {learning.status === 'proposed' && !askingReject && (
          <>
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={() => perform('approve', { content: draftContent })}
                  disabled={busy !== null || !draftContent.trim()}
                  className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded px-3 py-1.5 transition-colors"
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve edited'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditing(false); setDraftContent(learning.content) }}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Cancel edit
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => perform('approve')}
                  disabled={busy !== null}
                  className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded px-3 py-1.5 transition-colors"
                >
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs font-medium border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 rounded px-3 py-1.5 transition-colors"
                >
                  Edit wording
                </button>
                <button
                  type="button"
                  onClick={() => setAskingReject(true)}
                  className="text-xs font-medium border border-red-500/30 text-red-300 hover:text-red-200 hover:border-red-500/50 rounded px-3 py-1.5 transition-colors"
                >
                  Reject
                </button>
              </>
            )}
          </>
        )}
        {learning.status === 'approved' && !askingReject && (
          <>
            {/* Apply requires an agentId only for this_agent scope —
                workspace and all_agents live in the runtime injection
                table, no individual agent needs to be writable. */}
            <button
              type="button"
              onClick={() => perform('apply')}
              disabled={busy !== null || (learning.scope === 'this_agent' && !learning.agentId)}
              className="text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded px-3 py-1.5 transition-colors"
            >
              {busy === 'apply' ? 'Applying…' :
                learning.scope === 'all_agents' ? 'Apply to all agents' :
                learning.scope === 'workspace' ? 'Apply to workspace' :
                'Apply to agent'}
            </button>
            <button
              type="button"
              onClick={() => setAskingReject(true)}
              className="text-xs font-medium border border-red-500/30 text-red-300 hover:text-red-200 hover:border-red-500/50 rounded px-3 py-1.5 transition-colors"
            >
              Reject
            </button>
          </>
        )}
        {learning.status === 'applied' && (
          <button
            type="button"
            onClick={() => perform('retire')}
            disabled={busy !== null}
            className="text-xs font-medium border border-amber-500/30 text-amber-300 hover:text-amber-200 hover:border-amber-500/50 rounded px-3 py-1.5 transition-colors"
          >
            {busy === 'retire' ? 'Retiring…' :
              learning.scope === 'all_agents' ? 'Retire (stop injecting globally)' :
              learning.scope === 'workspace' ? 'Retire (stop injecting in workspace)' :
              'Retire (remove from agent)'}
          </button>
        )}
      </div>
    </div>
  )
}
