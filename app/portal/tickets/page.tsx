import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'
import { relTime } from '@/components/inbox/conversation-helpers'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Tickets · Customer Portal',
  robots: { index: false, follow: false },
}

const OPEN_STATUSES = ['open', 'pending', 'on_hold']
const AGING_MS = 24 * 60 * 60 * 1000

export default async function PortalTickets() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  if (session.brandIds.length === 0) {
    return (
      <div className="p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-white">Tickets</h1>
        <p className="text-sm text-zinc-400 mt-2">No brands assigned yet.</p>
      </div>
    )
  }

  const brands = await db.brand.findMany({ where: { id: { in: session.brandIds } }, select: { id: true, name: true, primaryColor: true } })
  const brandById = new Map(brands.map(b => [b.id, b]))
  const where = { brandId: { in: session.brandIds } }
  const agingBefore = new Date(Date.now() - AGING_MS)

  const [openCount, resolvedCount, totalCount, atRisk, rows] = await Promise.all([
    db.ticket.count({ where: { ...where, status: { in: OPEN_STATUSES } } }),
    db.ticket.count({ where: { ...where, status: { in: ['resolved', 'closed'] } } }),
    db.ticket.count({ where }),
    db.ticket.count({ where: { ...where, status: { in: OPEN_STATUSES }, createdAt: { lt: agingBefore } } }),
    db.ticket.findMany({
      where,
      orderBy: [{ lastActivityAt: 'desc' }],
      take: 30,
      select: { id: true, ticketNumber: true, subject: true, priority: true, status: true, brandId: true, createdAt: true },
    }),
  ])

  const resolutionRate = totalCount > 0 ? Math.round((resolvedCount / totalCount) * 100) : 0

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-white">Tickets</h1>
        <p className="text-sm text-zinc-400 mt-1">Support tickets raised across your brands.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-6">
        <Kpi label="Open Tickets" value={openCount.toLocaleString()} tone="accent" />
        <Kpi label="Resolution Rate" value={`${resolutionRate}%`} tone="emerald" sub={`${resolvedCount.toLocaleString()} resolved of ${totalCount.toLocaleString()}`} />
        <Kpi label="At Risk (>24h open)" value={atRisk.toLocaleString()} tone={atRisk > 0 ? 'red' : 'default'} />
      </div>

      <div className="rounded-xl border border-zinc-800 overflow-hidden mt-5" style={{ background: 'var(--surface)' }}>
        <div className="px-4 py-2.5 border-b border-zinc-800">
          <p className="text-xs text-zinc-400"><span className="font-semibold text-zinc-100">{totalCount.toLocaleString()}</span> tickets</p>
        </div>
        {rows.length === 0 ? (
          <div className="p-12 text-center"><p className="text-sm text-zinc-500">No tickets yet.</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="text-zinc-500 text-[10px] uppercase tracking-wider" style={{ background: 'var(--surface-secondary)' }}>
                <tr>
                  <Th>#</Th><Th>Subject</Th><Th>Brand</Th><Th>Priority</Th><Th>Status</Th><Th>Reported</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map(t => {
                  const brand = t.brandId ? brandById.get(t.brandId) : null
                  return (
                    <tr key={t.id} className="border-t border-zinc-800 hover:bg-[var(--surface-secondary)] transition-colors">
                      <Td><span className="font-mono text-[11px] text-zinc-400">#{t.ticketNumber}</span></Td>
                      <Td><span className="text-xs text-zinc-100 line-clamp-1 max-w-[320px]">{t.subject}</span></Td>
                      <Td>{brand ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-zinc-300">
                          <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: brand.primaryColor || 'var(--portal-accent)' }} />{brand.name}
                        </span>
                      ) : <span className="text-zinc-600 text-xs">—</span>}</Td>
                      <Td><PriorityBadge priority={t.priority} /></Td>
                      <Td><StatusBadge status={t.status} /></Td>
                      <Td><span className="text-[11px] text-zinc-500">{relTime(t.createdAt.toISOString())}</span></Td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'emerald' | 'accent' | 'red' }) {
  const color = tone === 'emerald' ? 'var(--accent-emerald)' : tone === 'accent' ? 'var(--portal-accent)' : tone === 'red' ? 'var(--accent-red)' : 'var(--text-primary)'
  return (
    <div className="rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] text-zinc-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function PriorityBadge({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    urgent: { bg: 'var(--accent-red-bg)', fg: 'var(--accent-red)' },
    high: { bg: 'var(--accent-amber-bg)', fg: 'var(--accent-amber)' },
    normal: { bg: 'var(--surface-tertiary)', fg: 'var(--text-tertiary)' },
    low: { bg: 'var(--surface-tertiary)', fg: 'var(--text-muted)' },
  }
  const m = map[priority] ?? map.normal
  return <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize" style={{ background: m.bg, color: m.fg }}>{priority}</span>
}

function StatusBadge({ status }: { status: string }) {
  const resolved = status === 'resolved' || status === 'closed'
  return (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize" style={resolved
      ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
      : { background: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' }}>
      {status.replace('_', ' ')}
    </span>
  )
}

function Th({ children }: { children: React.ReactNode }) { return <th className="text-left px-4 py-2.5 font-semibold">{children}</th> }
function Td({ children }: { children: React.ReactNode }) { return <td className="px-4 py-2.5 align-middle">{children}</td> }
