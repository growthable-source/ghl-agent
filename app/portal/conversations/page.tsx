import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { relTime } from '@/components/inbox/conversation-helpers'
import ConversationFilters from './ConversationFilters'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Conversation Logs · Customer Portal',
  robots: { index: false, follow: false },
}

interface SearchParams {
  brand?: string
  page?: string
  q?: string
  channel?: string
  handled?: string
  status?: string
  from?: string
  to?: string
}

const PAGE_SIZE = 25

export default async function PortalConversationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  if (session.brandIds.length === 0) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <Header />
        <div className="border border-dashed border-zinc-800 rounded-xl p-12 text-center mt-6">
          <p className="text-sm text-zinc-400">No brands are assigned to your account yet, so there are no conversations to show.</p>
        </div>
      </div>
    )
  }

  const allowedBrands = await db.brand.findMany({
    where: { id: { in: session.brandIds } },
    select: { id: true, name: true, slug: true, logoUrl: true, primaryColor: true },
    orderBy: { name: 'asc' },
  })
  const brandBySlug = new Map(allowedBrands.map(b => [b.slug, b]))
  const brandById = new Map(allowedBrands.map(b => [b.id, b]))

  // Brand filter — only honoured for brands the user may see.
  const filterBrand = sp.brand ? brandBySlug.get(sp.brand.trim()) ?? null : null
  const effectiveBrandIds = filterBrand ? [filterBrand.id] : session.brandIds

  const widgets = await db.chatWidget.findMany({
    where: { brandId: { in: effectiveBrandIds } },
    select: { id: true, brandId: true, name: true },
  })
  const widgetIds = widgets.map(w => w.id)
  const widgetById = new Map(widgets.map(w => [w.id, w]))

  // Build the shared WHERE from the active filters. Applied to both the
  // summary metrics and the table so the strip reflects what's on screen.
  const q = (sp.q ?? '').trim()
  const fromDate = sp.from ? new Date(sp.from) : null
  const toDate = sp.to ? new Date(sp.to + 'T23:59:59') : null
  const where: Record<string, unknown> = { widgetId: { in: widgetIds } }
  if (sp.handled === 'ai') where.assignedUserId = null
  else if (sp.handled === 'human') where.assignedUserId = { not: null }
  if (sp.status === 'active' || sp.status === 'ended') where.status = sp.status
  if (sp.channel === 'voice') where.voiceCalls = { some: {} }
  else if (sp.channel === 'live_chat') where.voiceCalls = { none: {} }
  if (fromDate && !isNaN(fromDate.getTime())) where.lastMessageAt = { ...(where.lastMessageAt as object ?? {}), gte: fromDate }
  if (toDate && !isNaN(toDate.getTime())) where.lastMessageAt = { ...(where.lastMessageAt as object ?? {}), lte: toDate }
  if (q) {
    where.OR = [
      { visitor: { name: { contains: q, mode: 'insensitive' } } },
      { visitor: { email: { contains: q, mode: 'insensitive' } } },
      { id: { contains: q } },
    ]
  }

  const noWidgets = widgetIds.length === 0
  const [total, rows, ratingGroups, aiHandled] = noWidgets
    ? [0, [], [] as Array<{ csatRating: number | null; _count: { _all: number } }>, 0]
    : await Promise.all([
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
            assignedUserId: true,
            assignedUser: { select: { name: true, email: true } },
            visitor: { select: { id: true, name: true, email: true } },
            _count: { select: { messages: true } },
            voiceCalls: { select: { id: true }, take: 1 },
          },
        }),
        db.widgetConversation.groupBy({ by: ['csatRating'], where, _count: { _all: true } }),
        db.widgetConversation.count({ where: { ...where, assignedUserId: null } }),
      ])

  // Metrics. Sentiment is CSAT-derived (4–5 positive, 1–2 negative) over
  // rated chats — a real signal we have today. AI-inferred sentiment for
  // every conversation is a flagged follow-up (no per-chat analysis pass
  // exists for live chat yet).
  let positive = 0, negative = 0, rated = 0
  for (const g of ratingGroups) {
    const r = g.csatRating
    if (r == null) continue
    rated += g._count._all
    if (r >= 4) positive += g._count._all
    else if (r <= 2) negative += g._count._all
  }
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)
  const aiPct = pct(aiHandled, total)

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const exportQs = new URLSearchParams(
    Object.entries({ brand: sp.brand, q: sp.q, channel: sp.channel, handled: sp.handled, status: sp.status, from: sp.from, to: sp.to })
      .filter(([, v]) => v) as [string, string][],
  ).toString()

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <Header exportHref={`/api/portal/conversations/export${exportQs ? `?${exportQs}` : ''}`} />

      {/* Summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6">
        <Metric label="Total Conversations" value={total.toLocaleString()} />
        <Metric label="Positive (rated)" value={`${pct(positive, rated)}%`} tone="emerald" sub={`${positive.toLocaleString()} of ${rated.toLocaleString()} rated`} />
        <Metric label="Negative (rated)" value={`${pct(negative, rated)}%`} tone="red" sub={`${negative.toLocaleString()} of ${rated.toLocaleString()} rated`} />
        <Metric label="AI-handled" value={`${aiPct}%`} tone="accent" sub={`${(total - aiHandled).toLocaleString()} reached a human`} />
      </div>

      {/* Filters + search */}
      <ConversationFilters
        brands={allowedBrands.map(b => ({ name: b.name, slug: b.slug }))}
        current={{ brand: sp.brand ?? '', q: sp.q ?? '', channel: sp.channel ?? '', handled: sp.handled ?? '', status: sp.status ?? '', from: sp.from ?? '', to: sp.to ?? '' }}
      />

      {/* Table */}
      <div className="rounded-xl border border-zinc-800 overflow-hidden mt-4" style={{ background: 'var(--surface)' }}>
        <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
          <p className="text-xs text-zinc-400">
            <span className="font-semibold text-zinc-100">{total.toLocaleString()}</span> {total === 1 ? 'conversation' : 'conversations'}
            {filterBrand ? <> · {filterBrand.name}</> : null}
          </p>
          <p className="text-[11px] text-zinc-500">Page {page} of {totalPages}</p>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center"><p className="text-sm text-zinc-500">No conversations match these filters.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead className="text-zinc-500 text-[10px] uppercase tracking-wider" style={{ background: 'var(--surface-secondary)' }}>
                <tr>
                  <Th>Session</Th><Th>Customer</Th><Th>Brand</Th><Th>Channel</Th>
                  <Th>Handled by</Th><Th>Sentiment</Th><Th>Msgs</Th><Th>Date</Th><Th> </Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(c => {
                  const widget = widgetById.get(c.widgetId)
                  const brand = widget?.brandId ? brandById.get(widget.brandId) : null
                  const isVoice = c.voiceCalls.length > 0
                  const human = !!c.assignedUserId
                  const sentiment = c.csatRating == null ? null : c.csatRating >= 4 ? 'positive' : c.csatRating <= 2 ? 'negative' : 'neutral'
                  return (
                    <tr key={c.id} className="border-t border-zinc-800 hover:bg-[var(--surface-secondary)] transition-colors">
                      <Td>
                        <Link href={`/portal/conversations/${c.id}`} className="font-mono text-[11px] inline-flex items-center gap-1.5 text-zinc-300 hover:text-[var(--portal-accent)]">
                          <span className="w-1 h-5 rounded-full" style={{ background: brand?.primaryColor || 'var(--portal-accent)' }} />
                          #{c.id.slice(-6).toUpperCase()}
                        </Link>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ background: brand?.primaryColor || 'var(--portal-accent)' }}>
                            {(c.visitor.name || c.visitor.email || 'V').charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0">
                            <p className="text-zinc-100 text-xs font-medium truncate max-w-[160px]">{c.visitor.name || 'Anonymous'}</p>
                            {c.visitor.email && <p className="text-[10px] text-zinc-500 truncate max-w-[160px]">{c.visitor.email}</p>}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        {brand ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                            <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ background: brand.primaryColor || 'var(--portal-accent)' }} />
                            <span className="truncate max-w-[110px]">{brand.name}</span>
                          </span>
                        ) : <span className="text-zinc-600 text-xs">—</span>}
                      </Td>
                      <Td><ChannelPill voice={isVoice} /></Td>
                      <Td>
                        {human ? (
                          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            {c.assignedUser?.name || c.assignedUser?.email || 'Human'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-zinc-400">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--portal-accent)' }} /> AI agent
                          </span>
                        )}
                      </Td>
                      <Td><SentimentBadge sentiment={sentiment} /></Td>
                      <Td><span className="text-xs text-zinc-400">{c._count.messages}</span></Td>
                      <Td><span className="text-[11px] text-zinc-500">{relTime(c.lastMessageAt.toISOString())}</span></Td>
                      <Td>
                        <Link href={`/portal/conversations/${c.id}`} className="text-[11px] font-medium text-zinc-400 hover:text-[var(--portal-accent)] whitespace-nowrap">
                          View →
                        </Link>
                      </Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 mt-5 text-xs">
          <PageLink sp={sp} page={page - 1} disabled={page <= 1} label="← Prev" />
          <span className="text-zinc-600">Page {page} of {totalPages}</span>
          <PageLink sp={sp} page={page + 1} disabled={page >= totalPages} label="Next →" />
        </div>
      )}
    </div>
  )
}

function Header({ exportHref }: { exportHref?: string }) {
  return (
    <div className="flex items-start justify-between gap-4 flex-wrap">
      <div>
        <h1 className="text-2xl font-semibold text-white">Conversation Logs</h1>
        <p className="text-sm text-zinc-400 mt-1">Transcript audit &amp; interaction history.</p>
      </div>
      {exportHref && (
        <a href={exportHref} className="px-3.5 py-2 rounded-lg text-sm font-semibold text-white whitespace-nowrap" style={{ background: 'var(--portal-accent)' }}>
          Export CSV
        </a>
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'red' | 'accent' }) {
  const color = tone === 'emerald' ? 'var(--accent-emerald)' : tone === 'red' ? 'var(--accent-red)' : tone === 'accent' ? 'var(--portal-accent)' : 'var(--text-primary)'
  return (
    <div className="rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function ChannelPill({ voice }: { voice: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: voice ? '#a855f7' : '#22c55e' }} />
      {voice ? 'Voice' : 'Live Chat'}
    </span>
  )
}

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'negative' | 'neutral' | null }) {
  if (!sentiment) return <span className="text-zinc-600 text-xs">—</span>
  const map = {
    positive: { label: 'Positive', bg: 'var(--accent-emerald-bg)', fg: 'var(--accent-emerald)' },
    negative: { label: 'Negative', bg: 'var(--accent-red-bg)', fg: 'var(--accent-red)' },
    neutral: { label: 'Neutral', bg: 'var(--surface-tertiary)', fg: 'var(--text-tertiary)' },
  }[sentiment]
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: map.bg, color: map.fg }}>{map.label}</span>
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-4 py-2.5 font-semibold">{children}</th>
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-2.5 align-middle">{children}</td>
}

function PageLink({ sp, page, disabled, label }: { sp: SearchParams; page: number; disabled: boolean; label: string }) {
  if (disabled) return <span className="px-2.5 py-1 rounded border border-zinc-800 text-zinc-700 cursor-not-allowed">{label}</span>
  const qs = new URLSearchParams(
    Object.entries({ ...sp, page: String(page) }).filter(([, v]) => v) as [string, string][],
  ).toString()
  return <Link href={`/portal/conversations?${qs}`} className="px-2.5 py-1 rounded border border-zinc-800 text-zinc-300 hover:border-zinc-600">{label}</Link>
}
