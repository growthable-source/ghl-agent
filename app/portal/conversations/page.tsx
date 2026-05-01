import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Conversations · Customer Portal',
  robots: { index: false, follow: false },
}

interface SearchParams { brand?: string; page?: string }

const PAGE_SIZE = 30

export default async function PortalConversationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const sp = await searchParams
  const brandSlug = (sp.brand ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  if (session.brandIds.length === 0) {
    return (
      <div className="p-10 max-w-3xl">
        <h1 className="text-2xl font-semibold text-white">Conversations</h1>
        <p className="text-sm text-zinc-400 mt-2">
          You don't have any brands assigned yet, so there are no conversations to show.
        </p>
      </div>
    )
  }

  // The user's allowed brands. We resolve them with full names so the
  // filter chip strip can label everything correctly.
  const allowedBrands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  })

  // If the user passed ?brand=<slug>, narrow to that brand BUT only if
  // it's one they're allowed to see — otherwise silently fall back to
  // "all assigned brands". Never trust the URL to expand access.
  const filterBrand = brandSlug
    ? allowedBrands.find(b => b.slug === brandSlug) ?? null
    : null
  const effectiveBrandIds = filterBrand ? [filterBrand.id] : session.brandIds

  // Resolve widget IDs for the effective brand set.
  const widgets = await db.chatWidget.findMany({
    where: { brandId: { in: effectiveBrandIds } },
    select: { id: true, brandId: true, name: true },
  })
  const widgetIds = widgets.map(w => w.id)
  const widgetById = new Map(widgets.map(w => [w.id, w]))

  if (widgetIds.length === 0) {
    return (
      <Layout brands={allowedBrands} active={filterBrand?.slug ?? null}>
        <p className="text-sm text-zinc-500">No widgets are tagged to these brands yet.</p>
      </Layout>
    )
  }

  const where = { widgetId: { in: widgetIds } }
  const [total, rows] = await Promise.all([
    db.widgetConversation.count({ where }),
    db.widgetConversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      take: PAGE_SIZE,
      skip,
      select: {
        id: true,
        widgetId: true,
        status: true,
        csatRating: true,
        lastMessageAt: true,
        createdAt: true,
        visitor: { select: { id: true, name: true, email: true } },
        _count: { select: { messages: true } },
      },
    }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <Layout brands={allowedBrands} active={filterBrand?.slug ?? null}>
      {rows.length === 0 ? (
        <div className="border border-dashed border-zinc-800 rounded-lg p-10 text-center">
          <p className="text-sm text-zinc-500">No conversations yet.</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-zinc-500 mb-3">
            {total.toLocaleString()} {total === 1 ? 'conversation' : 'conversations'}
            {filterBrand ? ` · ${filterBrand.name}` : ''}
          </p>
          <div className="border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 text-zinc-400 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Visitor</th>
                  <th className="text-left px-4 py-2 font-medium">Widget</th>
                  <th className="text-left px-4 py-2 font-medium">Messages</th>
                  <th className="text-left px-4 py-2 font-medium">CSAT</th>
                  <th className="text-left px-4 py-2 font-medium">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const widget = widgetById.get(c.widgetId)
                  return (
                    <tr key={c.id} className="border-t border-zinc-800 hover:bg-zinc-900/40">
                      <td className="px-4 py-3">
                        <Link
                          href={`/portal/conversations/${c.id}`}
                          className="text-zinc-100 hover:text-amber-400 font-medium"
                        >
                          {c.visitor.name ?? c.visitor.email ?? 'Anonymous visitor'}
                        </Link>
                        {c.visitor.email && c.visitor.name && (
                          <p className="text-xs text-zinc-500">{c.visitor.email}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{widget?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-zinc-400 text-xs">{c._count.messages}</td>
                      <td className="px-4 py-3 text-xs">
                        {c.csatRating ? (
                          <span className="text-amber-400">{'★'.repeat(c.csatRating)}<span className="text-zinc-700">{'★'.repeat(5 - c.csatRating)}</span></span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-zinc-500 text-xs">
                        {new Date(c.lastMessageAt).toLocaleString()}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-2 mt-4 text-xs">
              {page > 1 && (
                <Link
                  href={`/portal/conversations?${new URLSearchParams({
                    ...(filterBrand ? { brand: filterBrand.slug } : {}),
                    page: String(page - 1),
                  }).toString()}`}
                  className="px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                >
                  ← Prev
                </Link>
              )}
              <span className="text-zinc-600">Page {page} of {totalPages}</span>
              {page < totalPages && (
                <Link
                  href={`/portal/conversations?${new URLSearchParams({
                    ...(filterBrand ? { brand: filterBrand.slug } : {}),
                    page: String(page + 1),
                  }).toString()}`}
                  className="px-2 py-1 rounded border border-zinc-800 text-zinc-400 hover:text-zinc-200"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </Layout>
  )
}

function Layout({
  brands, active, children,
}: {
  brands: { id: string; name: string; slug: string }[]
  active: string | null
  children: React.ReactNode
}) {
  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-2xl font-semibold text-white">Conversations</h1>
      <div className="flex flex-wrap gap-2 mt-4 mb-6">
        <FilterChip href="/portal/conversations" label="All" active={active === null} />
        {brands.map(b => (
          <FilterChip
            key={b.id}
            href={`/portal/conversations?brand=${b.slug}`}
            label={b.name}
            active={active === b.slug}
          />
        ))}
      </div>
      {children}
    </div>
  )
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        'px-2.5 py-1 rounded text-xs border transition-colors ' +
        (active
          ? 'bg-amber-400 text-zinc-950 border-amber-400'
          : 'bg-zinc-900 text-zinc-300 border-zinc-800 hover:border-zinc-600')
      }
    >
      {label}
    </Link>
  )
}
