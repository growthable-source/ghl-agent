import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Session · Customer Portal',
  robots: { index: false, follow: false },
}

type Params = { params: Promise<{ id: string }> }

export default async function PortalConversationPage({ params }: Params) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const { id } = await params

  const c = await db.widgetConversation.findUnique({
    where: { id },
    select: {
      id: true, status: true, csatRating: true, csatComment: true,
      lastMessageAt: true, createdAt: true, initiatedUrl: true, initiatedTitle: true,
      assignedUserId: true,
      assignedUser: { select: { name: true, email: true } },
      visitor: { select: { name: true, email: true, phone: true, firstSeenAt: true } },
      widget: { select: { name: true, brandId: true, brand: { select: { name: true, primaryColor: true } } } },
      messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, content: true, createdAt: true, kind: true } },
    },
  })
  if (!c) notFound()
  const brandId = c.widget.brandId
  if (!brandId || !session.brandIds.includes(brandId)) notFound()

  const visitorMsgs = c.messages.filter(m => m.role === 'visitor' || m.role === 'user').length
  const agentMsgs = c.messages.length - visitorMsgs
  const durationMs = c.lastMessageAt.getTime() - c.createdAt.getTime()
  const human = !!c.assignedUserId
  const accent = c.widget.brand?.primaryColor || 'var(--portal-accent)'
  const sentiment = c.csatRating == null ? null : c.csatRating >= 4 ? 'positive' : c.csatRating <= 2 ? 'negative' : 'neutral'

  return (
    <div className="p-6 sm:p-8 max-w-7xl mx-auto">
      <Link href="/portal/conversations" className="text-zinc-500 hover:text-zinc-300 text-sm">← Conversation Logs</Link>

      {/* Session sub-header */}
      <div className="mt-3 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-semibold text-white font-mono">Session #{c.id.slice(-6).toUpperCase()}</h1>
        <StatusPill status={c.status} />
        <span className="text-xs text-zinc-500">
          {c.widget.brand?.name ?? 'Unbranded'} · {c.widget.name} · {new Date(c.createdAt).toLocaleString()}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5 mt-5">
        {/* LEFT: transcript */}
        <div className="rounded-xl border border-zinc-800 overflow-hidden" style={{ background: 'var(--surface)' }}>
          <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Transcript</p>
            <p className="text-[11px] text-zinc-500">{c.messages.length} messages</p>
          </div>
          <div className="p-4 space-y-3">
            {c.messages.length === 0 ? (
              <p className="text-sm text-zinc-500 text-center py-8">No messages.</p>
            ) : (
              c.messages.map(m => <Bubble key={m.id} message={m} accent={accent} />)
            )}
            {c.status === 'ended' && (
              <div className="flex items-center justify-center gap-2 pt-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}>
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}><path d="M5 13l4 4L19 7" /></svg>
                  Conversation resolved
                </span>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT: metadata rail */}
        <div className="space-y-4">
          <Card title="Customer Profile">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold text-white" style={{ background: accent }}>
                {(c.visitor.name || c.visitor.email || 'V').charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-sm text-zinc-100 truncate">{c.visitor.name || 'Anonymous'}</p>
                {c.visitor.email && <p className="text-[11px] text-zinc-500 truncate">{c.visitor.email}</p>}
              </div>
            </div>
            {c.visitor.phone && <Field label="Phone" value={c.visitor.phone} />}
            <Field label="First seen" value={new Date(c.visitor.firstSeenAt).toLocaleDateString()} />
            {c.initiatedUrl && <Field label="Started on" value={c.initiatedTitle || c.initiatedUrl} />}
          </Card>

          <Card title="Session Metrics">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Duration" value={fmtDur(durationMs)} />
              <Stat label="Messages" value={String(c.messages.length)} />
              <Stat label="From customer" value={String(visitorMsgs)} />
              <Stat label="From support" value={String(agentMsgs)} />
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-800">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">CSAT</p>
              {c.csatRating ? (
                <p className="text-amber-400 text-sm">{'★'.repeat(c.csatRating)}<span className="text-zinc-700">{'★'.repeat(5 - c.csatRating)}</span></p>
              ) : <p className="text-xs text-zinc-600">Not rated</p>}
              {c.csatComment && <p className="text-xs text-zinc-400 mt-1.5 whitespace-pre-wrap">“{c.csatComment}”</p>}
            </div>
          </Card>

          <Card title="Sentiment">
            {sentiment ? (
              <>
                <div className="h-2 rounded-full overflow-hidden flex">
                  <div className="flex-1" style={{ background: 'var(--accent-red)' }} />
                  <div className="flex-1" style={{ background: 'var(--accent-amber)' }} />
                  <div className="flex-1" style={{ background: 'var(--accent-emerald)' }} />
                </div>
                <div className="relative h-0">
                  <div className="absolute -top-3 w-2 h-2 rotate-45 bg-white" style={{ left: `calc(${((c.csatRating! - 1) / 4) * 100}% - 4px)` }} />
                </div>
                <p className="text-sm font-semibold mt-3" style={{ color: sentiment === 'positive' ? 'var(--accent-emerald)' : sentiment === 'negative' ? 'var(--accent-red)' : 'var(--accent-amber)' }}>
                  {sentiment === 'positive' ? 'Positive' : sentiment === 'negative' ? 'Negative' : 'Neutral'}
                </p>
                <p className="text-[10px] text-zinc-500">Derived from the {c.csatRating}★ CSAT rating.</p>
              </>
            ) : (
              <p className="text-xs text-zinc-500">No rating yet — AI sentiment scoring for every chat is a planned enhancement.</p>
            )}
          </Card>

          <Card title="Agent Involvement">
            <div className="space-y-2">
              {agentMsgs > 0 && (
                <Involve color="var(--portal-accent)" label="AI agent" detail={`${agentMsgs} ${agentMsgs === 1 ? 'reply' : 'replies'}`} />
              )}
              {human && (
                <Involve color="var(--accent-blue)" label={c.assignedUser?.name || c.assignedUser?.email || 'Human agent'} detail="took over" />
              )}
              {!human && agentMsgs > 0 && (
                <p className="text-[10px] text-zinc-500 pt-1">Handled end-to-end by AI — no human needed.</p>
              )}
            </div>
          </Card>

          <Card title="Quick Actions">
            <Link href="/portal/conversations" className="block w-full text-center text-xs font-medium px-3 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:border-zinc-500">
              Back to all logs
            </Link>
          </Card>
        </div>
      </div>
    </div>
  )
}

function fmtDur(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

function StatusPill({ status }: { status: string }) {
  const ended = status === 'ended'
  return <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize" style={ended
    ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
    : { background: 'var(--accent-blue-bg)', color: 'var(--accent-blue)' }}>{ended ? 'Resolved' : status}</span>
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-zinc-800 p-4" style={{ background: 'var(--surface)' }}>
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-3">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-300 truncate max-w-[170px]" title={value}>{value}</span>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-bold text-white leading-tight">{value}</p>
      <p className="text-[10px] text-zinc-500">{label}</p>
    </div>
  )
}

function Involve({ color, label, detail }: { color: string; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-xs text-zinc-200 flex-1 truncate">{label}</span>
      <span className="text-[10px] text-zinc-500">{detail}</span>
    </div>
  )
}

function Bubble({ message, accent }: { message: { role: string; content: string; createdAt: Date; kind: string }; accent: string }) {
  if (message.role === 'system') {
    return <div className="text-center"><span className="text-[10px] text-zinc-500 italic">{message.content}</span></div>
  }
  const isVisitor = message.role === 'visitor' || message.role === 'user'
  return (
    <div className={'flex ' + (isVisitor ? 'justify-start' : 'justify-end')}>
      <div className={'max-w-[78%] ' + (isVisitor ? '' : 'text-right')}>
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
          {isVisitor ? 'Customer' : 'Support'} · {new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </p>
        {message.kind === 'image' ? (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={message.content} target="_blank" rel="noopener noreferrer" className="inline-block rounded-lg overflow-hidden border border-zinc-700 max-w-[60%]"><img src={message.content} alt="attachment" className="block w-full" /></a>
        ) : (
          <div className={'inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap text-left ' + (isVisitor ? 'text-zinc-100' : 'text-zinc-100 border')}
            style={isVisitor ? { background: 'var(--surface-tertiary)' } : { background: `color-mix(in srgb, ${accent} 12%, transparent)`, borderColor: `color-mix(in srgb, ${accent} 25%, transparent)` }}>
            {message.content}
          </div>
        )}
      </div>
    </div>
  )
}
