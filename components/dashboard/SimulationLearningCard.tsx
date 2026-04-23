'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

export interface SimLearningData {
  id: string
  scope: string
  type: string
  title: string
  content: string
  rationale: string | null
  status: string
}

interface Props {
  learning: SimLearningData
  workspaceId: string
  // True when the current user has workspace role = owner|admin. Members
  // see the card but without the Retire button — they proposed the
  // simulation but don't have permission to mutate the agent prompt.
  canManage: boolean
}

/**
 * Inline learning card on the simulation detail page.
 *
 * The card itself shows status, content, rationale — identical info as
 * the admin-side LearningRow, just simpler. The Retire button appears
 * only for applied this_agent learnings (the only kind workspace-side
 * users can roll back). Workspace/all_agents learnings are surfaced
 * read-only with an explanatory note.
 */
export default function SimulationLearningCard({ learning, workspaceId, canManage }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function retire() {
    if (!confirm(`Retire this learning?\n\nThis removes the guidance from your agent's system prompt. It will no longer influence future replies.`)) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/learnings/${learning.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'retire' }),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        let msg = text.slice(0, 300)
        try {
          const parsed = JSON.parse(text)
          if (parsed?.error) msg = parsed.error
        } catch { /* */ }
        throw new Error(`${res.status} — ${msg}`)
      }
      router.refresh()
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const statusCls =
    learning.status === 'applied' ? 'text-emerald-400 bg-emerald-500/10' :
    learning.status === 'approved' ? 'text-blue-400 bg-blue-500/10' :
    learning.status === 'proposed' ? 'text-amber-400 bg-amber-500/10' :
    learning.status === 'rejected' ? 'text-zinc-500 bg-zinc-800 line-through' :
    learning.status === 'retired' ? 'text-zinc-500 bg-zinc-800' :
    'text-zinc-500 bg-zinc-900'

  const scopeCls =
    learning.scope === 'all_agents' ? 'text-purple-300 bg-purple-500/15 border-purple-500/40' :
    learning.scope === 'workspace' ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' :
    'text-zinc-400 bg-zinc-900 border-zinc-800'

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/60 p-3 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-semibold uppercase tracking-wider rounded border px-1.5 py-0.5 ${scopeCls}`}>
          {learning.scope.replace(/_/g, ' ')}
        </span>
        <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 ${statusCls}`}>
          {learning.status}
        </span>
        <span className="text-xs text-zinc-200 font-medium">{learning.title}</span>
      </div>
      {learning.rationale && (
        <p className="text-[11px] text-zinc-500 italic">{learning.rationale}</p>
      )}
      <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap bg-zinc-950/60 p-2 rounded border border-zinc-800 font-sans">
        {learning.content}
      </pre>

      {/* State-dependent footer. */}
      {learning.status === 'applied' && learning.scope === 'this_agent' && canManage && (
        <div className="flex items-center gap-2 pt-1">
          <span className="text-[11px] text-emerald-300">
            ✓ Applied to your agent&apos;s system prompt. Live on the next inbound (within ~30s).
          </span>
          <button
            type="button"
            onClick={retire}
            disabled={busy}
            className="text-[11px] font-medium border border-amber-500/30 text-amber-300 hover:text-amber-200 hover:border-amber-500/50 rounded px-2 py-0.5 transition-colors ml-auto disabled:opacity-50"
          >
            {busy ? 'Retiring…' : 'Retire'}
          </button>
        </div>
      )}
      {learning.status === 'applied' && learning.scope !== 'this_agent' && (
        <p className="text-[11px] text-zinc-500 pt-1">
          Applied platform-wide by an admin.
        </p>
      )}
      {learning.status === 'proposed' && (
        <p className="text-[11px] text-zinc-500 pt-1">
          {learning.scope === 'all_agents'
            ? 'Broad scope — awaiting super-admin review.'
            : 'Awaiting admin review.'}
        </p>
      )}
      {learning.status === 'retired' && (
        <p className="text-[11px] text-zinc-500 pt-1">
          Retired — no longer influencing your agent.
        </p>
      )}
      {error && (
        <p className="text-[11px] text-red-300 pt-1">{error}</p>
      )}
    </div>
  )
}
