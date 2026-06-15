/**
 * Top Topics panel body for the portal Overview — the knowledge
 * collections the AI matched to answer visitor questions, ranked by how
 * many distinct conversations touched each. Pure presentational; the
 * caller supplies counts from lib/portal/overview-insights.ts.
 */

export default function TopTopics({ topics }: { topics: { topic: string; count: number }[] }) {
  if (topics.length === 0) {
    return (
      <p className="text-xs text-zinc-500 py-2">
        No topic matches yet. As the AI answers from your knowledge base, the collections it draws on appear here.
      </p>
    )
  }

  const max = topics[0].count
  return (
    <div className="space-y-2">
      {topics.map((t, i) => {
        const w = Math.round((t.count / max) * 100)
        return (
          <div key={t.topic}>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-zinc-600 w-3">{i + 1}</span>
              <span className="text-xs text-zinc-200 flex-1 truncate" title={t.topic}>{t.topic}</span>
              <span className="text-xs font-semibold text-zinc-400">{t.count.toLocaleString()}</span>
            </div>
            <div className="h-1 rounded-full mt-1 ml-5 overflow-hidden" style={{ background: 'var(--surface-tertiary)' }}>
              <div className="h-full rounded-full" style={{ width: `${w}%`, background: 'var(--portal-accent)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
