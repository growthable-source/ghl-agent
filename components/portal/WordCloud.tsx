/**
 * Word cloud for the portal Overview — top words/phrases visitors are
 * asking about, sized + tinted by frequency. Pure server component; the
 * caller computes terms with lib/word-cloud.ts.
 */

import type { Term } from '@/lib/word-cloud'

export default function WordCloud({ terms }: { terms: Term[] }) {
  if (terms.length === 0) {
    return (
      <p className="text-xs text-zinc-500 py-6 text-center">
        Not enough questions yet — the cloud fills in as visitors chat.
      </p>
    )
  }

  const counts = terms.map(t => t.count)
  const max = Math.max(...counts)
  const min = Math.min(...counts)
  const span = Math.max(1, max - min)

  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
      {terms.map(t => {
        const w = (t.count - min) / span // 0..1
        const size = 12 + Math.round(w * 16) // 12 → 28px
        // Hottest terms in full accent; cooler ones fade toward muted text.
        const color = `color-mix(in srgb, var(--portal-accent) ${Math.round(30 + w * 70)}%, var(--text-tertiary))`
        const weight = w > 0.6 ? 700 : w > 0.3 ? 600 : 500
        return (
          <span
            key={t.term}
            className="leading-none"
            style={{ fontSize: size, color, fontWeight: weight }}
            title={`${t.count.toLocaleString()} ${t.count === 1 ? 'mention' : 'mentions'}`}
          >
            {t.term}
          </span>
        )
      })}
    </div>
  )
}
