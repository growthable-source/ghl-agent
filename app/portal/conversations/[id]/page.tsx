import Link from 'next/link'
import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { getPortalSession } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Conversation · Customer Portal',
  robots: { index: false, follow: false },
}

type Params = { params: Promise<{ id: string }> }

export default async function PortalConversationPage({ params }: Params) {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  const { id } = await params

  const conversation = await db.widgetConversation.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      csatRating: true,
      csatComment: true,
      csatSubmittedAt: true,
      lastMessageAt: true,
      createdAt: true,
      visitor: { select: { name: true, email: true } },
      widget: {
        select: {
          id: true,
          name: true,
          brandId: true,
          brand: { select: { id: true, name: true, slug: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, role: true, content: true, createdAt: true, kind: true },
      },
    },
  })

  if (!conversation) notFound()

  // Hard authorization gate. The conversation must belong to a widget
  // tagged to a brand the user is allowed to see. notFound() (rather
  // than a 403) so we don't leak which conversation IDs exist.
  const brandId = conversation.widget.brandId
  if (!brandId || !session.brandIds.includes(brandId)) {
    notFound()
  }

  return (
    <div className="p-8 max-w-3xl">
      <Link href="/portal/conversations" className="text-zinc-500 hover:text-zinc-300 text-sm">
        ← Conversations
      </Link>

      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-white">
            {conversation.visitor.name ?? conversation.visitor.email ?? 'Anonymous visitor'}
          </h1>
          <p className="text-xs text-zinc-500 mt-1">
            {conversation.widget.brand?.name ?? 'Unbranded'}
            <span className="mx-2 text-zinc-700">·</span>
            {conversation.widget.name}
            <span className="mx-2 text-zinc-700">·</span>
            Started {new Date(conversation.createdAt).toLocaleString()}
          </p>
        </div>
        <div className="text-right">
          {conversation.csatRating ? (
            <div>
              <p className="text-xs text-zinc-500">CSAT</p>
              <p className="text-amber-400">
                {'★'.repeat(conversation.csatRating)}
                <span className="text-zinc-700">{'★'.repeat(5 - conversation.csatRating)}</span>
              </p>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">No rating</p>
          )}
        </div>
      </div>

      {conversation.csatComment && (
        <div className="mt-4 border border-amber-900/40 bg-amber-950/20 rounded-lg p-3">
          <p className="text-[10px] uppercase tracking-wider text-amber-400/80 mb-1">
            Visitor comment
          </p>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap">{conversation.csatComment}</p>
        </div>
      )}

      <div className="mt-6 border border-zinc-800 rounded-lg bg-zinc-900/30 divide-y divide-zinc-800/60">
        {conversation.messages.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-zinc-500">No messages.</p>
        ) : (
          conversation.messages.map(m => <Message key={m.id} message={m} />)
        )}
      </div>
    </div>
  )
}

function Message({
  message,
}: {
  message: { id: string; role: string; content: string; createdAt: Date; kind: string }
}) {
  // Visitor messages on the left, agent on the right. Match conventions
  // operators see in the inbox so the transcript reads the same.
  const isVisitor = message.role === 'visitor' || message.role === 'user'
  return (
    <div className={'px-4 py-3 flex ' + (isVisitor ? 'justify-start' : 'justify-end')}>
      <div className={'max-w-[80%] ' + (isVisitor ? '' : 'text-right')}>
        <p className="text-[10px] uppercase tracking-wider text-zinc-600 mb-1">
          {isVisitor ? 'Visitor' : 'Agent'}
          <span className="mx-1">·</span>
          {new Date(message.createdAt).toLocaleString()}
        </p>
        <div
          className={
            'inline-block px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ' +
            (isVisitor
              ? 'bg-zinc-800 text-zinc-100'
              : 'bg-[color-mix(in_srgb,var(--portal-accent)_12%,transparent)] text-zinc-100 border border-[color-mix(in_srgb,var(--portal-accent)_25%,transparent)]')
          }
        >
          {message.content}
        </div>
      </div>
    </div>
  )
}
