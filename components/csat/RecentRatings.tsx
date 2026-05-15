'use client'

/**
 * The "Recent ratings" list at the bottom of the dashboard. Each row
 * links to the full conversation in the inbox.
 */

import Link from 'next/link'
import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  recent: CsatResponse['recent']
  workspaceId: string
}

export default function RecentRatings({ recent, workspaceId }: Props) {
  return (
    <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <div className="p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Recent ratings</h2>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
          Click through to see the full conversation in the inbox.
        </p>
      </div>
      {recent.map(r => {
        const bg = r.rating >= 4 ? 'var(--accent-green-bg, rgba(34,197,94,0.15))'
          : r.rating === 3 ? 'var(--accent-amber-bg)'
          : 'var(--accent-red-bg)'
        const fg = r.rating >= 4 ? 'var(--accent-green, #22c55e)'
          : r.rating === 3 ? 'var(--accent-amber)'
          : 'var(--accent-red)'
        return (
          <Link
            key={r.conversationId}
            href={`/dashboard/${workspaceId}/inbox?conversation=${r.conversationId}`}
            className="block p-4 border-t hover:bg-zinc-900/40 transition-colors"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-start gap-3">
              <div className="text-sm font-semibold tabular-nums w-12 text-center py-1 rounded" style={{ background: bg, color: fg }}>
                {r.rating}★
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-tertiary)' }}>
                  <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{r.visitorLabel}</span>
                  <span>·</span>
                  <span>{r.widgetName}</span>
                  {r.brandName && (<><span>·</span><span>{r.brandName}</span></>)}
                  {r.agentName && (<><span>·</span><span>{r.agentName}</span></>)}
                  <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-semibold ${r.handler === 'human' ? 'bg-blue-500/10 text-blue-300' : 'bg-purple-500/10 text-purple-300'}`}>
                    {r.handler}
                  </span>
                  <span className="ml-auto">{r.submittedAt ? timeAgo(r.submittedAt) : ''}</span>
                </div>
                {r.comment && (
                  <p className="text-sm mt-1 italic line-clamp-3" style={{ color: 'var(--text-primary)' }}>
                    &ldquo;{r.comment}&rdquo;
                  </p>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
