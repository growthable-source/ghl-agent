import Link from 'next/link'
import { db } from '@/lib/db'
import { Avatar, KpiTile, PageHeader, Pill } from '@/components/ui/primitives'
import { buttonClass, dataTable } from '@/lib/ui-classes'
import { timeAgo } from '@/lib/agents-list'

/**
 * Contacts — primary nav object. Renders one of two views depending
 * on the workspace's CRM provider:
 *
 * - **Native CRM**: real CRUD against the NativeContact table. Shows
 *   first/last/email/phone/tags + a link to the per-contact timeline.
 * - **GHL/HubSpot/etc.**: agent's address book — every contactId the
 *   agent has spoken to (derived from MessageLog), since for external
 *   CRMs we don't own the contact store.
 */
export default async function ContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ page?: string; q?: string; view?: string }>
}) {
  const { workspaceId } = await params
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1') || 1)
  const q = (sp.q ?? '').trim()
  const view = sp.view === 'suppressed' ? 'suppressed' : 'all'
  const PAGE_SIZE = 25

  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true, crmProvider: true },
  })
  const isNative = locations.some(l => l.crmProvider === 'native')

  if (isNative) {
    return <NativeContactsView workspaceId={workspaceId} page={page} q={q} view={view} pageSize={PAGE_SIZE} />
  }
  return <LegacyContactsView workspaceId={workspaceId} page={page} pageSize={PAGE_SIZE} locationIds={locations.map(l => l.id)} />
}

/** Module-level so the render body stays pure (server component, runs per request). */
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

// ─── Native view ────────────────────────────────────────────────────────

async function NativeContactsView({
  workspaceId, page, pageSize, q, view,
}: { workspaceId: string; page: number; pageSize: number; q: string; view: 'all' | 'suppressed' }) {
  const where: any = { workspaceId }
  if (view === 'suppressed') where.isSuppressed = true
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const weekAgo = daysAgo(7)
  const [workspaceTotal, newThisWeek, optedOut] = await Promise.all([
    db.nativeContact.count({ where: { workspaceId } }),
    db.nativeContact.count({ where: { workspaceId, createdAt: { gte: weekAgo } } }),
    db.nativeContact.count({ where: { workspaceId, isSuppressed: true } }),
  ])
  const [contacts, total] = await Promise.all([
    db.nativeContact.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.nativeContact.count({ where }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1
  const end = Math.min(total, page * pageSize)

  const viewHref = (v: string) => `/dashboard/${workspaceId}/contacts?${[q ? `q=${encodeURIComponent(q)}` : '', v === 'suppressed' ? 'view=suppressed' : ''].filter(Boolean).join('&')}`
  return (
    <div className="p-6">
      <div className="max-w-[1200px] mx-auto space-y-4">
        <PageHeader
          title="Contacts"
          subtitle="Your native contacts database. Manage people, tags, and reach state."
          actions={<>
            <Link href={`/dashboard/${workspaceId}/imports`} className={buttonClass('secondary')}>Import CSV</Link>
            {/* TODO(redesign-followup): Export contacts — no export endpoint for native contacts yet. */}
            <Link href={`/dashboard/${workspaceId}/contacts/new`} className={buttonClass('primary')}>+ Add contact</Link>
          </>}
        />

        {/* TODO(redesign-followup): "Engaged · 7d" and "Booked · 7d" tiles — no per-contact engagement/booking aggregates exist. */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiTile label="Total contacts" value={workspaceTotal.toLocaleString()} delta={newThisWeek > 0 ? `+${newThisWeek.toLocaleString()} this week` : undefined} />
          <KpiTile label="Added · 7d" value={newThisWeek.toLocaleString()} />
          <KpiTile label="Opted out" value={optedOut.toLocaleString()} suffix={workspaceTotal > 0 ? `${((optedOut / workspaceTotal) * 100).toFixed(1)}%` : undefined} />
        </div>

        <div className="xv-card">
          <div className="flex flex-wrap items-center gap-2 p-3 border-b border-border-theme">
            {/* Views: only the ones backed by data (All / Suppressed). Leads, Customers and Needs human need a contact stage. */}
            <div className="inline-flex items-center rounded-md bg-surface-secondary p-0.5">
              {([['all', 'All'], ['suppressed', 'Suppressed']] as const).map(([v, label]) => (
                <Link key={v} href={viewHref(v)} aria-current={view === v ? 'page' : undefined}
                  className={`h-7 px-2.5 inline-flex items-center rounded text-[12px] font-medium ${view === v ? 'bg-surface text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-primary'}`}>
                  {label}
                </Link>
              ))}
            </div>
            <form className="ml-auto flex items-center gap-2">
              {view === 'suppressed' && <input type="hidden" name="view" value="suppressed" />}
              <input type="search" name="q" placeholder="Search name, email, phone…" defaultValue={q}
                className="h-8 w-[260px] rounded-md border border-border-theme bg-surface px-2.5 text-[12.5px] outline-none focus:border-brand-500" />
            </form>
          </div>

          {contacts.length === 0 ? (
            <EmptyState
              title={q ? 'No matches' : view === 'suppressed' ? 'No suppressed contacts' : 'No contacts yet'}
              body={q ? 'Try a different search.' : view === 'suppressed' ? 'Contacts who opt out will appear here.' : 'Import a CSV or add contacts manually to get started.'}
            />
          ) : (
            <table className={dataTable.table}>
              <thead className={dataTable.thead}>
                <tr>
                  {['Contact', 'Phone', 'Tags', 'Status', 'Updated'].map(h => <th key={h} className={dataTable.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {contacts.map(c => {
                  const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '(no name)'
                  return (
                    <tr key={c.id} className={dataTable.tr()}>
                      <td className={dataTable.td}>
                        <Link href={`/dashboard/${workspaceId}/contacts/${c.id}`} className="flex items-center gap-3 min-w-0">
                          <Avatar name={name} size={34} />
                          <span className="min-w-0">
                            <span className="block font-medium truncate hover:underline">{name}</span>
                            <span className="block text-[12px] text-text-tertiary truncate">{c.email ?? '—'}</span>
                          </span>
                        </Link>
                      </td>
                      <td className={`${dataTable.td} font-mono text-[12px] text-text-secondary`}>{c.phone ?? '—'}</td>
                      <td className={dataTable.td}>
                        <div className="flex flex-wrap gap-1">
                          {c.tags.length > 0
                            ? <>{c.tags.slice(0, 3).map((t: string) => <Pill key={t}>{t}</Pill>)}{c.tags.length > 3 && <span className="text-[11px] text-text-muted">+{c.tags.length - 3}</span>}</>
                            : <span className="text-text-muted">—</span>}
                        </div>
                      </td>
                      <td className={dataTable.td}>{c.isSuppressed ? <Pill tone="danger">Opted out</Pill> : <Pill tone="success">Active</Pill>}</td>
                      <td className={`${dataTable.td} text-text-secondary whitespace-nowrap`}>{timeAgo(c.updatedAt.toISOString())}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {/* TODO(redesign-followup): Stage, Channels, Last agent and Source columns, row checkboxes/bulk actions, Filter / Source / Columns controls — native contacts don't store them. */}
          <div className="px-4 pb-3"><Pagination workspaceId={workspaceId} basePath="contacts" page={page} totalPages={totalPages} q={q} start={start} end={end} total={total} /></div>
        </div>
      </div>
    </div>
  )
}

// ─── Legacy (GHL / external CRM) view ──────────────────────────────────

async function LegacyContactsView({
  workspaceId, page, pageSize, locationIds,
}: { workspaceId: string; page: number; pageSize: number; locationIds: string[] }) {
  const recent = locationIds.length > 0
    ? await db.messageLog.findMany({
        where: { locationId: { in: locationIds } },
        orderBy: { createdAt: 'desc' },
        distinct: ['contactId'],
        skip: (page - 1) * pageSize,
        take: pageSize + 1,
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
  const hasNext = recent.length > pageSize
  const rows = recent.slice(0, pageSize)
  const contactIds = rows.map(r => r.contactId)
  const counts = contactIds.length > 0
    ? await db.messageLog.groupBy({
        by: ['contactId'],
        where: { contactId: { in: contactIds }, locationId: { in: locationIds } },
        _count: { _all: true },
      })
    : []
  const countByContact = new Map(counts.map(c => [c.contactId, c._count._all]))

  return (
    <div className="p-6">
      <div className="max-w-[1200px] mx-auto space-y-4">
        <PageHeader title="Contacts" subtitle="Everyone your agents have talked to." />
        {rows.length === 0 ? (
          <div className="xv-card"><EmptyState title="No contacts yet" body="Contacts show up here once your agent starts replying to messages." /></div>
        ) : (
          <div className="xv-card overflow-hidden">
            <table className={dataTable.table}>
              <thead className={dataTable.thead}>
                <tr>
                  {['Contact', 'Last message', 'Agent', 'Messages', 'Last activity'].map(h => <th key={h} className={dataTable.th}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => {
                  const lastMessage = r.outboundReply ?? r.inboundMessage ?? ''
                  const isAgentLast = !!r.outboundReply
                  return (
                    <tr key={r.contactId} className={dataTable.tr()}>
                      <td className={dataTable.td}>
                        <Link href={`/dashboard/${workspaceId}/contacts/${r.contactId}`} className="flex items-center gap-3 min-w-0">
                          <Avatar name={r.contactId.slice(-4)} size={34} />
                          <span className="font-mono text-[12px] text-text-secondary truncate hover:underline" title={r.contactId}>{r.contactId}</span>
                        </Link>
                      </td>
                      <td className={`${dataTable.td} max-w-[420px] truncate ${isAgentLast ? 'text-text-tertiary' : 'text-text-primary'}`}>{isAgentLast ? '↪ ' : ''}{lastMessage}</td>
                      <td className={dataTable.td}>{r.agent?.name ? <Pill>{r.agent.name}</Pill> : '—'}</td>
                      <td className={`${dataTable.td} tabular-nums`}>{countByContact.get(r.contactId) ?? 0}</td>
                      <td className={`${dataTable.td} text-text-secondary whitespace-nowrap`}>{timeAgo(r.createdAt.toISOString())}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {/* TODO(redesign-followup): contact name / phone / stage for external-CRM contacts — only the CRM contact id is stored locally. */}
        <div className="flex items-center justify-end gap-2">
          {page > 1 && <Link href={`?page=${page - 1}`} className={buttonClass('secondary', 'sm')}>← Previous</Link>}
          {hasNext && <Link href={`?page=${page + 1}`} className={buttonClass('secondary', 'sm')}>Next →</Link>}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="text-center py-16">
      <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{body}</p>
    </div>
  )
}

function Pagination({
  workspaceId, basePath, page, totalPages, q, start, end, total,
}: {
  workspaceId: string; basePath: string; page: number; totalPages: number; q?: string; start: number; end: number; total: number
}) {
  const qs = (p: number) => `?${[q ? `q=${encodeURIComponent(q)}` : '', `page=${p}`].filter(Boolean).join('&')}`
  return (
    <div className="flex items-center justify-between mt-4">
      <div className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
        {total === 0 ? '0 contacts' : `${start}–${end} of ${total}`}
      </div>
      <div className="flex items-center gap-2">
        {page > 1 && <Link href={`/dashboard/${workspaceId}/${basePath}${qs(page - 1)}`} className="text-xs px-3 h-8 inline-flex items-center rounded-md border" style={{ borderColor: 'var(--border-secondary)' }}>← Previous</Link>}
        {page < totalPages && <Link href={`/dashboard/${workspaceId}/${basePath}${qs(page + 1)}`} className="text-xs px-3 h-8 inline-flex items-center rounded-md border" style={{ borderColor: 'var(--border-secondary)' }}>Next →</Link>}
      </div>
    </div>
  )
}
