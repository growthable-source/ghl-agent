import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export default async function PortalHome() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  // Empty assignment set = nothing to show. Friendly state instead of
  // a broken page.
  if (session.brandIds.length === 0) {
    return (
      <div className="p-10 max-w-3xl">
        <h1 className="text-2xl font-semibold text-white">Welcome</h1>
        <p className="text-sm text-zinc-400 mt-2">
          Your account doesn't have any brands assigned yet. Once your account contact assigns
          brands to you, conversations and CSAT data will appear here.
        </p>
      </div>
    )
  }

  // Resolve the widgets attached to the user's brands. We need widgetIds
  // for the conversation count query below, and (brandId → widgetIds)
  // for the per-brand breakdown.
  const widgets = await db.chatWidget.findMany({
    where: { brandId: { in: session.brandIds } },
    select: { id: true, brandId: true },
  })
  const widgetIds = widgets.map(w => w.id)
  const widgetIdsByBrand = new Map<string, string[]>()
  for (const w of widgets) {
    if (!w.brandId) continue
    const arr = widgetIdsByBrand.get(w.brandId) ?? []
    arr.push(w.id)
    widgetIdsByBrand.set(w.brandId, arr)
  }

  const since30d = new Date(Date.now() - 30 * 86_400_000)

  const brands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true },
    orderBy: { name: 'asc' },
  })

  // Per-brand stats for the dashboard cards. Run in parallel — even
  // with many brands this is cheap.
  const stats = await Promise.all(
    brands.map(async b => {
      const ids = widgetIdsByBrand.get(b.id) ?? []
      if (ids.length === 0) {
        return { brand: b, total: 0, recent: 0, csatAvg: null as number | null, csatCount: 0 }
      }
      const [total, recent, csat] = await Promise.all([
        db.widgetConversation.count({ where: { widgetId: { in: ids } } }),
        db.widgetConversation.count({ where: { widgetId: { in: ids }, lastMessageAt: { gte: since30d } } }),
        db.widgetConversation.aggregate({
          where: { widgetId: { in: ids }, csatRating: { not: null } },
          _avg: { csatRating: true },
          _count: { csatRating: true },
        }),
      ])
      return {
        brand: b,
        total,
        recent,
        csatAvg: csat._avg.csatRating,
        csatCount: csat._count.csatRating,
      }
    }),
  )

  // Workspace-wide totals for the top strip.
  const [totalConvs, totalCsat] = await Promise.all([
    db.widgetConversation.count({ where: { widgetId: { in: widgetIds } } }),
    db.widgetConversation.aggregate({
      where: { widgetId: { in: widgetIds }, csatRating: { not: null } },
      _avg: { csatRating: true },
      _count: { csatRating: true },
    }),
  ])

  return (
    <div className="p-8 max-w-5xl">
      <h1 className="text-2xl font-semibold text-white">Overview</h1>
      <p className="text-sm text-zinc-400 mt-1">
        Conversations and CSAT for your assigned brands.
      </p>

      <div className="grid grid-cols-3 gap-3 mt-6">
        <Stat label="Total conversations" value={totalConvs.toLocaleString()} />
        <Stat
          label="Avg CSAT"
          value={totalCsat._avg.csatRating ? totalCsat._avg.csatRating.toFixed(2) + ' / 5' : '—'}
          hint={`${totalCsat._count.csatRating} ratings`}
        />
        <Stat label="Brands" value={String(brands.length)} />
      </div>

      <h2 className="text-sm font-semibold text-zinc-300 mt-10 mb-3 uppercase tracking-wider">
        Brands
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {stats.map(s => (
          <Link
            key={s.brand.id}
            href={`/portal/conversations?brand=${s.brand.slug}`}
            className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30 hover:border-zinc-700 transition-colors"
          >
            <div className="flex items-center gap-3">
              {s.brand.logoUrl ? (
                <img src={s.brand.logoUrl} alt="" className="h-8 w-8 rounded object-cover" />
              ) : (
                <div
                  className="h-8 w-8 rounded"
                  style={{ background: s.brand.primaryColor || '#3f3f46' }}
                />
              )}
              <p className="text-zinc-100 font-medium">{s.brand.name}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
              <Mini label="Total" value={s.total.toLocaleString()} />
              <Mini label="Last 30d" value={s.recent.toLocaleString()} />
              <Mini
                label="CSAT"
                value={s.csatAvg ? s.csatAvg.toFixed(2) : '—'}
                hint={`${s.csatCount} ratings`}
              />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-zinc-800 rounded-lg p-4 bg-zinc-900/30">
      <p className="text-[11px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl text-zinc-100 mt-1">{value}</p>
      {hint && <p className="text-[11px] text-zinc-600 mt-0.5">{hint}</p>}
    </div>
  )
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</p>
      <p className="text-sm text-zinc-200">{value}</p>
      {hint && <p className="text-[10px] text-zinc-600">{hint}</p>}
    </div>
  )
}
