'use client'

/**
 * Per-human-operator rollup. Shows avatar (or initial-letter chip)
 * alongside name + email so operators recognise their teammates
 * without resolving an ID.
 */

import type { CsatResponse } from '@/lib/csat-types'

interface Props {
  byOperator: CsatResponse['byOperator']
}

export default function OperatorRollup({ byOperator }: Props) {
  if (byOperator.length === 0) return null
  return (
    <div className="rounded-xl border p-5 mb-6" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
      <h2 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
        By human operator <span className="text-[10px] uppercase tracking-wider font-normal" style={{ color: 'var(--text-tertiary)' }}>· blue = human</span>
      </h2>
      <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
        Ratings on chats your teammates were assigned to. A chat appears under both AI and human if it handed off.
      </p>
      <div className="space-y-2">
        {byOperator.map(o => (
          <div key={o.userId} className="flex items-center gap-3 py-2 border-t" style={{ borderColor: 'var(--border)' }}>
            {o.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={o.image} alt="" className="w-6 h-6 rounded-full shrink-0" />
            ) : (
              <span className="w-6 h-6 rounded-full shrink-0 bg-blue-500/20 text-blue-300 text-[10px] font-semibold flex items-center justify-center">
                {(o.name || o.email || '?').charAt(0).toUpperCase()}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{o.name}</p>
              {o.email && o.email !== o.name && (
                <p className="text-[10px] truncate" style={{ color: 'var(--text-tertiary)' }}>{o.email}</p>
              )}
            </div>
            <span className="text-xs tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
              {o.count} rating{o.count === 1 ? '' : 's'}
            </span>
            <span className="text-sm font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>
              {o.avg.toFixed(2)} <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>/ 5</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
