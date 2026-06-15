import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Reports · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalReports() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const since30d = new Date(Date.now() - 30 * 86_400_000)
  let convos30 = 0, csat = 0, ratings = 0
  if (session.brandIds.length > 0) {
    const widgets = await db.chatWidget.findMany({ where: { brandId: { in: session.brandIds } }, select: { id: true } })
    const widgetIds = widgets.map(w => w.id)
    if (widgetIds.length > 0) {
      const [c, agg] = await Promise.all([
        db.widgetConversation.count({ where: { widgetId: { in: widgetIds }, createdAt: { gte: since30d } } }),
        db.widgetConversation.aggregate({ where: { widgetId: { in: widgetIds } }, _avg: { csatRating: true }, _count: { csatRating: true } }),
      ])
      convos30 = c
      csat = agg._avg.csatRating ? Math.round((agg._avg.csatRating / 5) * 1000) / 10 : 0
      ratings = agg._count.csatRating
    }
  }

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="text-sm text-zinc-400 mt-1">Export and review your support performance.</p>
        </div>
        <a href="/api/portal/conversations/export" className="px-3.5 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: 'var(--portal-accent)' }}>
          Export conversation logs (CSV)
        </a>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
        <Tile label="Conversations (30d)" value={convos30.toLocaleString()} />
        <Tile label="CSAT Score" value={csat ? `${csat}%` : '—'} sub={`${ratings.toLocaleString()} ratings`} />
        <Tile label="Detailed analytics" value="In the logs" link="/portal/conversations" />
      </div>

      <div className="rounded-xl border border-zinc-800 p-6 mt-5" style={{ background: 'var(--surface)' }}>
        <p className="text-sm font-medium text-zinc-200">Scheduled reports &amp; charts</p>
        <p className="text-xs text-zinc-500 mt-1 max-w-xl">
          The full charting suite (sentiment-over-time, channel split, SLA trends) builds on per-conversation
          sentiment analysis, which isn&rsquo;t computed for live chat yet. For now, the Overview dashboard and the
          CSV export above cover the live numbers — deeper visual reporting is a fast follow-up once that lands.
        </p>
        <div className="flex gap-2 mt-3">
          <Link href="/portal" className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500">Overview dashboard</Link>
          <Link href="/portal/conversations" className="text-xs font-medium px-3 py-1.5 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500">Conversation logs</Link>
        </div>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, link }: { label: string; value: string; sub?: string; link?: string }) {
  const inner = (
    <div className="rounded-xl border border-zinc-800 p-4 h-full" style={{ background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold mt-1 text-white">{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
  return link ? <Link href={link}>{inner}</Link> : inner
}
