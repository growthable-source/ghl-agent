import Link from 'next/link'
import { db } from '@/lib/db'

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
  searchParams: Promise<{ page?: string; q?: string }>
}) {
  const { workspaceId } = await params
  const sp = await searchParams
  const page = Math.max(1, parseInt(sp.page ?? '1') || 1)
  const q = (sp.q ?? '').trim()
  const PAGE_SIZE = 25

  const locations = await db.location.findMany({
    where: { workspaceId },
    select: { id: true, crmProvider: true },
  })
  const isNative = locations.some(l => l.crmProvider === 'native')

  if (isNative) {
    return <NativeContactsView workspaceId={workspaceId} page={page} q={q} pageSize={PAGE_SIZE} />
  }
  return <LegacyContactsView workspaceId={workspaceId} page={page} pageSize={PAGE_SIZE} locationIds={locations.map(l => l.id)} />
}

// ─── Native view ────────────────────────────────────────────────────────

async function NativeContactsView({
  workspaceId, page, pageSize, q,
}: { workspaceId: string; page: number; pageSize: number; q: string }) {
  const where: any = { workspaceId }
  if (q) {
    where.OR = [
      { email: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ]
  }

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

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              Your native contacts database. Manage people, tags, and reach state.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/dashboard/${workspaceId}/imports`}
              className="text-xs font-semibold px-3 h-9 inline-flex items-center rounded-lg border transition-opacity hover:opacity-90"
              style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-primary)' }}
            >
              Import CSV
            </Link>
            <Link
              href={`/dashboard/${workspaceId}/contacts/new`}
              className="text-xs font-semibold px-3 h-9 inline-flex items-center rounded-lg transition-opacity hover:opacity-90"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              + New contact
            </Link>
          </div>
        </div>

        {/* Search */}
        <form className="mb-4">
          <input
            type="search"
            name="q"
            placeholder="Search by name, email, or phone…"
            defaultValue={q}
            className="w-full px-3 h-9 rounded-lg border text-sm"
            style={{ borderColor: 'var(--input-border)', background: 'var(--input-bg)', color: 'var(--input-text)' }}
          />
        </form>

        {contacts.length === 0 ? (
          <EmptyState
            title={q ? 'No matches' : 'No contacts yet'}
            body={q ? 'Try a different search.' : 'Import a CSV or add contacts manually to get started.'}
          />
        ) : (
          <>
            <div
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div
                className="grid items-center gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold border-b"
                style={{
                  gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.6fr) minmax(0,0.6fr)',
                  color: 'var(--text-muted)',
                  borderColor: 'var(--border)',
                  background: 'var(--surface-secondary)',
                }}
              >
                <span>Name</span>
                <span>Email</span>
                <span>Phone</span>
                <span>Tags</span>
                <span className="text-right">Status</span>
              </div>
              {contacts.map(c => {
                const name = [c.firstName, c.lastName].filter(Boolean).join(' ') || '(no name)'
                return (
                  <Link
                    key={c.id}
                    href={`/dashboard/${workspaceId}/contacts/${c.id}`}
                    className="grid items-center gap-3 px-4 py-3 border-t transition-colors hover:opacity-95"
                    style={{
                      gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.6fr) minmax(0,0.6fr)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{name}</span>
                    <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{c.email ?? '—'}</span>
                    <span className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{c.phone ?? '—'}</span>
                    <span className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                      {c.tags.length > 0 ? c.tags.slice(0, 4).join(', ') + (c.tags.length > 4 ? '…' : '') : '—'}
                    </span>
                    <span className="text-xs text-right">
                      {c.isSuppressed ? (
                        <span style={{ color: 'var(--accent-red)' }}>opted out</span>
                      ) : (
                        <span style={{ color: 'var(--accent-emerald)' }}>active</span>
                      )}
                    </span>
                  </Link>
                )
              })}
            </div>
            <Pagination workspaceId={workspaceId} basePath="contacts" page={page} totalPages={totalPages} q={q} start={start} end={end} total={total} />
          </>
        )}
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
    <div className="p-6 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Everyone your agent has talked to.</p>
          </div>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="No contacts yet" body="Contacts show up here once your agent starts replying to messages." />
        ) : (
          <div
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <div
              className="grid items-center gap-3 px-4 py-2.5 text-[10px] uppercase tracking-wider font-semibold border-b"
              style={{
                gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,2.4fr) minmax(0,1fr) minmax(0,0.6fr)',
                color: 'var(--text-muted)',
                borderColor: 'var(--border)',
                background: 'var(--surface-secondary)',
              }}
            >
              <span>Contact</span>
              <span>Last message</span>
              <span>Agent</span>
              <span className="text-right">Messages</span>
            </div>
            {rows.map(r => {
              const lastMessage = r.outboundReply ?? r.inboundMessage ?? ''
              const isAgentLast = !!r.outboundReply
              const messageCount = countByContact.get(r.contactId) ?? 0
              return (
                <Link
                  key={r.contactId}
                  href={`/dashboard/${workspaceId}/contacts/${r.contactId}`}
                  className="grid items-center gap-3 px-4 py-3 border-t transition-colors hover:opacity-95"
                  style={{
                    gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,2.4fr) minmax(0,1fr) minmax(0,0.6fr)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{r.contactId}</span>
                  <span className="text-xs truncate" style={{ color: isAgentLast ? 'var(--text-tertiary)' : 'var(--text-primary)' }}>
                    {isAgentLast ? '↪ ' : ''}{lastMessage}
                  </span>
                  <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{r.agent?.name ?? '—'}</span>
                  <span className="text-xs text-right" style={{ color: 'var(--text-secondary)' }}>{messageCount}</span>
                </Link>
              )
            })}
          </div>
        )}
        <div className="flex items-center justify-end gap-2 mt-4">
          {page > 1 && <Link href={`?page=${page - 1}`} className="text-xs px-3 h-8 inline-flex items-center rounded-md border" style={{ borderColor: 'var(--border-secondary)' }}>← Previous</Link>}
          {hasNext && <Link href={`?page=${page + 1}`} className="text-xs px-3 h-8 inline-flex items-center rounded-md border" style={{ borderColor: 'var(--border-secondary)' }}>Next →</Link>}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="text-center py-16 border border-dashed rounded-xl"
      style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface)' }}
    >
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
