import Link from 'next/link'
import { db } from '@/lib/db'

/**
 * Contacts — primary nav object. Lists every CRM contact the workspace
 * has spoken to, sorted by most recent activity. Intentionally a flat
 * list (no pipelines, no stages) — this is the agent's address book,
 * not a CRM. The detail page at [contactId] handles the unified
 * timeline view.
 */
export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { workspaceId } = await params
  const { page: pageParam } = await searchParams
  const page = Math.max(1, parseInt(pageParam ?? '1') || 1)
  const PAGE_SIZE = 25

  // Workspace → locations → message logs. Same scoping pattern used by
  // the rest of the dashboard pages.
  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true },
  })
  const locationIds = locations.map(l => l.id)

  // Recent activity per distinct contact. Prisma's distinct + orderBy
  // gives us the latest row per contactId without a self-join. We
  // overshoot the page size to know whether a "Next" link is needed
  // — pagination via ?page=N rather than offset cursors keeps the URL
  // simple for what is essentially a stable recency list.
  const recent = locationIds.length > 0
    ? await db.messageLog.findMany({
        where: { locationId: { in: locationIds } },
        orderBy: { createdAt: 'desc' },
        distinct: ['contactId'],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE + 1,
        select: {
          contactId: true,
          inboundMessage: true,
          outboundReply: true,
          createdAt: true,
          conversationId: true,
          agent: { select: { id: true, name: true } },
        },
      })
    : []

  const hasNext = recent.length > PAGE_SIZE
  const rows = recent.slice(0, PAGE_SIZE)

  // Per-contact message count for the rows on this page. Cheaper than
  // joining in the main query because the row set is tiny.
  const contactIds = rows.map(r => r.contactId)
  const counts = contactIds.length > 0
    ? await db.messageLog.groupBy({
        by: ['contactId'],
        where: { contactId: { in: contactIds }, locationId: { in: locationIds } },
        _count: { _all: true },
      })
    : []
  const countByContact = new Map(counts.map(c => [c.contactId, c._count._all]))

  // Total contacts (for the header subtitle). Lightweight — same
  // distinct + count, no row payload.
  const totalContacts = locationIds.length > 0
    ? (await db.messageLog.findMany({
        where: { locationId: { in: locationIds } },
        distinct: ['contactId'],
        select: { contactId: true },
      })).length
    : 0

  const start = totalContacts === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const end = (page - 1) * PAGE_SIZE + rows.length

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Everyone your agent has talked to.
            </p>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            {totalContacts} {totalContacts === 1 ? 'contact' : 'contacts'}
          </div>
        </div>

        {/* List */}
        {rows.length === 0 ? (
          <div
            className="text-center py-16 border border-dashed rounded-xl"
            style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
          >
            <div
              className="w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center"
              style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>No contacts yet</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Contacts show up here once your agent starts replying to messages.
            </p>
          </div>
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            {/* Table header */}
            <div
              className="grid items-center gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold border-b"
              style={{
                gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,2.4fr) minmax(0,1fr) minmax(0,0.7fr) minmax(0,0.6fr)',
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
                background: 'var(--surface-secondary)',
              }}
            >
              <span>Contact</span>
              <span>Last message</span>
              <span>Agent</span>
              <span>Last seen</span>
              <span className="text-right">Messages</span>
            </div>
            {/* Rows */}
            {rows.map(r => {
              const lastMessage = r.outboundReply ?? r.inboundMessage ?? ''
              const isAgentLast = !!r.outboundReply
              const messageCount = countByContact.get(r.contactId) ?? 0
              const initial = (r.contactId.replace(/[^a-z0-9]/gi, '').charAt(0) || '?').toUpperCase()
              return (
                <Link
                  key={r.contactId}
                  href={`/dashboard/${workspaceId}/contacts/${r.contactId}`}
                  className="grid items-center gap-3 px-4 py-3 border-t transition-colors hover:bg-zinc-900/40"
                  style={{
                    gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,2.4fr) minmax(0,1fr) minmax(0,0.7fr) minmax(0,0.6fr)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-semibold"
                      style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                    >
                      {initial}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                        {r.contactId.length > 24 ? `${r.contactId.slice(0, 8)}…${r.contactId.slice(-6)}` : r.contactId}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        CRM contact
                      </p>
                    </div>
                  </div>
                  <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {isAgentLast && (
                      <span
                        className="inline-flex items-center text-[9px] font-bold tracking-wider px-1 py-px rounded mr-1.5 align-middle"
                        style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
                      >
                        AI
                      </span>
                    )}
                    {lastMessage || <span className="italic" style={{ color: 'var(--text-muted)' }}>(no content)</span>}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                    {r.agent?.name ?? <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </p>
                  <p className="text-xs whitespace-nowrap" style={{ color: 'var(--text-tertiary)' }}>
                    {timeAgo(r.createdAt)}
                  </p>
                  <p className="text-xs text-right tabular-nums" style={{ color: 'var(--text-tertiary)' }}>
                    {messageCount}
                  </p>
                </Link>
              )
            })}
          </div>
        )}

        {/* Pagination */}
        {(rows.length > 0 && (page > 1 || hasNext)) && (
          <div className="flex items-center justify-between mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            <span>
              Showing <span style={{ color: 'var(--text-secondary)' }}>{start}</span>–
              <span style={{ color: 'var(--text-secondary)' }}>{end}</span>
              {totalContacts > 0 && <> of {totalContacts}</>}
            </span>
            <div className="flex items-center gap-2">
              {page > 1 ? (
                <Link
                  href={`/dashboard/${workspaceId}/contacts?page=${page - 1}`}
                  className="px-3 py-1.5 rounded-lg border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  ← Previous
                </Link>
              ) : (
                <span
                  className="px-3 py-1.5 rounded-lg border opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  ← Previous
                </span>
              )}
              {hasNext ? (
                <Link
                  href={`/dashboard/${workspaceId}/contacts?page=${page + 1}`}
                  className="px-3 py-1.5 rounded-lg border transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Next →
                </Link>
              ) : (
                <span
                  className="px-3 py-1.5 rounded-lg border opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                >
                  Next →
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function timeAgo(date: Date): string {
  const s = Math.floor((Date.now() - date.getTime()) / 1000)
  if (s < 60) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 30) return `${d}d ago`
  return `${Math.floor(d / 30)}mo ago`
}
