'use client'

/**
 * Per-AI-agent rollup. Each row links to that agent's detail page.
 * Purple dot signals "this is an AI agent" to contrast with the blue
 * avatars on the parallel OperatorRollup.
 */

import Link from 'next/link'
import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  byAgent: CsatResponse['byAgent']
  workspaceId: string
}

export default function AgentRollup({ byAgent, workspaceId }: Props) {
  if (byAgent.length === 0) return null
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        By AI agent <span className="text-[10px] uppercase tracking-wider font-normal" style={{ color: 'var(--text-tertiary)' }}>· purple = AI</span>
      </h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Rating spread across each AI agent config. A chat that handed off to a human is still counted here — the rating reflects the whole experience.
      </p>
      <div className="space-y-2">
        {byAgent.map(a => (
          <div key={a.agentId ?? '∅'} className="flex items-center gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-purple-400" />
            {a.agentId ? (
              <Link
                href={`/dashboard/${workspaceId}/agents/${a.agentId}`}
                className="text-sm flex-1 truncate hover:underline"
                style={{ color: 'var(--text-primary)' }}
              >
                {a.name}
              </Link>
            ) : (
              <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-tertiary)' }}>{a.name}</span>
            )}
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {a.count} rating{a.count === 1 ? '' : 's'}
            </span>
            <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {a.avg.toFixed(2)} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/ 5</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
