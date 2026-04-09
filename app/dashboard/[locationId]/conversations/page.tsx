import { db } from '@/lib/db'

interface PageProps {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ state?: string }>
}

const STATE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-900/40 text-emerald-400',
  PAUSED: 'bg-amber-900/40 text-amber-400',
  COMPLETED: 'bg-zinc-800 text-zinc-400',
}

function relativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}

export default async function ConversationsPage({ params, searchParams }: PageProps) {
  const { locationId } = await params
  const { state: stateFilter } = await searchParams

  // Fetch all conversations (unfiltered) for tab counts, and the filtered set for display
  const [allConversations, conversations] = await Promise.all([
    db.conversationStateRecord.findMany({
      where: { locationId },
      select: { state: true },
    }),
    db.conversationStateRecord.findMany({
      where: {
        locationId,
        ...(stateFilter && stateFilter !== 'ALL' ? { state: stateFilter as 'ACTIVE' | 'PAUSED' | 'COMPLETED' } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: { agent: { select: { id: true, name: true } } },
    }),
  ])

  // Count per state for tab badges
  const counts: Record<string, number> = { ALL: allConversations.length, ACTIVE: 0, PAUSED: 0, COMPLETED: 0 }
  for (const c of allConversations) {
    counts[c.state] = (counts[c.state] ?? 0) + 1
  }

  // Fetch latest message preview for each displayed conversation
  const previewMap = new Map<string, string>()
  if (conversations.length > 0) {
    const contactAgentPairs = conversations.map(c => ({ agentId: c.agentId, contactId: c.contactId }))
    // Batch query: get the latest message per (agentId, contactId) combo
    const latestMessages = await Promise.all(
      contactAgentPairs.map(pair =>
        db.conversationMessage.findFirst({
          where: { agentId: pair.agentId, contactId: pair.contactId },
          orderBy: { createdAt: 'desc' },
          select: { content: true, agentId: true, contactId: true },
        })
      )
    )
    for (const msg of latestMessages) {
      if (msg) {
        previewMap.set(`${msg.agentId}:${msg.contactId}`, msg.content)
      }
    }
  }

  const tabs = ['ALL', 'ACTIVE', 'PAUSED', 'COMPLETED'] as const
  const activeTab = stateFilter ?? 'ALL'

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold mb-2">Conversations</h1>
        <p className="text-zinc-400 text-sm mb-8">Track and manage all agent conversations for this location.</p>

        {/* Filter tabs */}
        <div className="flex gap-1 mb-6 border-b border-zinc-800">
          {tabs.map(tab => (
            <a
              key={tab}
              href={`/dashboard/${locationId}/conversations${tab === 'ALL' ? '' : `?state=${tab}`}`}
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px flex items-center gap-2 ${
                activeTab === tab
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.toLowerCase()}
              <span className={`text-xs rounded-full px-1.5 py-0.5 tabular-nums ${
                activeTab === tab
                  ? 'bg-zinc-700 text-zinc-200'
                  : 'bg-zinc-800/60 text-zinc-500'
              }`}>
                {counts[tab] ?? 0}
              </span>
            </a>
          ))}
        </div>

        {conversations.length === 0 && (
          <div className="text-center py-16">
            <div className="text-zinc-600 text-4xl mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-zinc-400 text-sm font-medium mb-1">No conversations yet</p>
            <p className="text-zinc-600 text-sm max-w-sm mx-auto">
              When your agents start handling messages, conversations will appear here.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {conversations.map(conv => {
            const preview = previewMap.get(`${conv.agentId}:${conv.contactId}`)
            return (
              <div key={conv.id} className="rounded-lg border border-zinc-800 px-4 py-4 hover:border-zinc-700 transition-colors">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATE_COLORS[conv.state] ?? ''}`}>
                        {conv.state}
                      </span>
                      <span className="text-xs text-zinc-500">{conv.messageCount} messages</span>
                      {conv.agent && (
                        <span className="text-xs text-zinc-600">via {conv.agent.name}</span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 font-mono truncate mt-0.5">{conv.contactId}</p>
                    {preview && (
                      <p className="text-sm text-zinc-300 mt-1.5 truncate">
                        {preview.length > 120 ? preview.slice(0, 120) + '...' : preview}
                      </p>
                    )}
                    {conv.pauseReason && (
                      <p className="text-xs text-amber-500 mt-1">Paused: {conv.pauseReason}</p>
                    )}
                    <p className="text-xs text-zinc-600 mt-1">
                      Updated {relativeTime(new Date(conv.updatedAt))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {conv.state === 'PAUSED' && (
                      <form action={async () => {
                        'use server'
                        await fetch(`${process.env.APP_URL}/api/locations/${locationId}/conversations/${conv.contactId}/pause`, {
                          method: 'DELETE',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ agentId: conv.agentId }),
                        })
                      }}>
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
                        >
                          Resume
                        </button>
                      </form>
                    )}
                    {conv.state === 'ACTIVE' && (
                      <form action={async () => {
                        'use server'
                        await fetch(`${process.env.APP_URL}/api/locations/${locationId}/conversations/${conv.contactId}/pause`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ agentId: conv.agentId, reason: 'manual' }),
                        })
                      }}>
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 rounded px-2 py-1 transition-colors"
                        >
                          Pause
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
