import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'

export const dynamic = 'force-dynamic'

interface SearchParams {
  status?: string
  locationId?: string
  agentId?: string
  contactId?: string
  page?: string
}

const PAGE_SIZE = 50

export default async function AdminLogsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')

  const sp = await searchParams
  const status = (sp.status ?? '').trim()
  const locationId = (sp.locationId ?? '').trim()
  const agentId = (sp.agentId ?? '').trim()
  const contactId = (sp.contactId ?? '').trim()
  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const skip = (page - 1) * PAGE_SIZE

  const where: any = {}
  if (status) where.status = status
  if (locationId) where.locationId = locationId
  if (agentId) where.agentId = agentId
  if (contactId) where.contactId = contactId

  const [total, rows] = await Promise.all([
    db.messageLog.count({ where }),
    db.messageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true, locationId: true, agentId: true, contactId: true,
        inboundMessage: true, outboundReply: true, errorMessage: true,
        status: true, actionsPerformed: true, tokensUsed: true,
        needsApproval: true, approvalStatus: true,
        createdAt: true,
      },
    }),
  ])

  logAdminAction({
    admin: session,
    action: 'view_logs',
    meta: { status, locationId, agentId, contactId, page, rowsReturned: rows.length },
  }).catch(() => {})

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="p-8 max-w-7xl space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold">Message logs</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {total.toLocaleString()} matching · {rows.length} shown
          </p>
        </div>
        <a
          href={`/api/admin/export/logs?${new URLSearchParams({ status, locationId, agentId, contactId }).toString()}`}
          className="text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 rounded-lg px-3 py-2 transition-colors"
        >
          Export CSV
        </a>
      </div>

      <form method="get" className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        <select
          name="status"
          defaultValue={status}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SUCCESS">Success</option>
          <option value="ERROR">Error</option>
          <option value="SKIPPED">Skipped</option>
        </select>
        <input
          name="locationId"
          defaultValue={locationId}
          placeholder="Location ID"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
        />
        <input
          name="agentId"
          defaultValue={agentId}
          placeholder="Agent ID"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
        />
        <input
          name="contactId"
          defaultValue={contactId}
          placeholder="Contact ID"
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 font-mono text-xs"
        />
        <button
          type="submit"
          className="text-sm font-medium text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg px-4 py-2 transition-colors"
        >
          Filter
        </button>
      </form>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 divide-y divide-zinc-900">
        {rows.map(r => (
          <div key={r.id} className="p-4 text-xs space-y-1.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-zinc-600 font-mono">{short(r.createdAt.toISOString())}</span>
              <StatusPill status={r.status} />
              {r.needsApproval && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                  Approval · {r.approvalStatus ?? 'pending'}
                </span>
              )}
              <span className="text-zinc-600 font-mono">loc {r.locationId.slice(-8)}</span>
              {r.agentId && <span className="text-zinc-600 font-mono">ag {r.agentId.slice(-8)}</span>}
              <span className="text-zinc-600 font-mono">ct {r.contactId.slice(-8)}</span>
              {r.tokensUsed != null && <span className="text-zinc-600">{r.tokensUsed} tok</span>}
              {r.actionsPerformed.length > 0 && (
                <span className="text-zinc-500">{r.actionsPerformed.join(', ')}</span>
              )}
            </div>
            {r.errorMessage && (
              <div className="text-red-300 bg-red-500/[0.05] border border-red-500/20 rounded px-2.5 py-1.5">
                {r.errorMessage}
              </div>
            )}
            {r.inboundMessage && (
              <div className="text-zinc-300">
                <span className="text-zinc-600">in:</span> {r.inboundMessage.slice(0, 220)}{r.inboundMessage.length > 220 ? '…' : ''}
              </div>
            )}
            {r.outboundReply && (
              <div className="text-zinc-400">
                <span className="text-zinc-600">out:</span> {r.outboundReply.slice(0, 220)}{r.outboundReply.length > 220 ? '…' : ''}
              </div>
            )}
          </div>
        ))}
        {rows.length === 0 && (
          <div className="p-8 text-center text-xs text-zinc-500">
            No logs match the filter.
          </div>
        )}
      </div>

      {pages > 1 && <Pagination page={page} pages={pages} params={{ status, locationId, agentId, contactId }} />}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const klass =
    status === 'SUCCESS' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' :
    status === 'ERROR' ? 'text-red-400 bg-red-500/10 border-red-500/30' :
    status === 'SKIPPED' ? 'text-zinc-500 bg-zinc-800 border-zinc-700' :
    'text-amber-400 bg-amber-500/10 border-amber-500/30'
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${klass}`}>
      {status}
    </span>
  )
}

function Pagination({ page, pages, params }: { page: number; pages: number; params: Record<string, string> }) {
  const mk = (p: number) => `?${new URLSearchParams({ ...params, page: String(p) }).toString()}`
  return (
    <div className="flex items-center justify-between text-xs text-zinc-500">
      <span>Page {page} of {pages}</span>
      <div className="flex gap-2">
        {page > 1 && <Link href={mk(page - 1)} className="text-blue-400 hover:text-blue-300">← Previous</Link>}
        {page < pages && <Link href={mk(page + 1)} className="text-blue-400 hover:text-blue-300">Next →</Link>}
      </div>
    </div>
  )
}

function short(iso: string): string {
  return iso.slice(0, 19).replace('T', ' ')
}
