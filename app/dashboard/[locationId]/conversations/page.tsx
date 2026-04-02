import { db } from '@/lib/db'
import { sendMessage } from '@/lib/crm-client'

interface PageProps {
  params: Promise<{ locationId: string }>
  searchParams: Promise<{ state?: string }>
}

const STATE_COLORS: Record<string, string> = {
  ACTIVE: 'bg-emerald-900/40 text-emerald-400',
  PAUSED: 'bg-amber-900/40 text-amber-400',
  COMPLETED: 'bg-zinc-800 text-zinc-400',
}

export default async function ConversationsPage({ params, searchParams }: PageProps) {
  const { locationId } = await params
  const { state: stateFilter } = await searchParams

  const conversations = await db.conversationStateRecord.findMany({
    where: {
      locationId,
      ...(stateFilter && stateFilter !== 'ALL' ? { state: stateFilter as 'ACTIVE' | 'PAUSED' | 'COMPLETED' } : {}),
    },
    orderBy: { updatedAt: 'desc' },
    include: { agent: { select: { id: true, name: true } } },
  })

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
              className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
                activeTab === tab
                  ? 'border-white text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {tab.toLowerCase()}
            </a>
          ))}
        </div>

        {conversations.length === 0 && (
          <p className="text-zinc-500 text-sm">No conversations found.</p>
        )}

        <div className="space-y-2">
          {conversations.map(conv => (
            <div key={conv.id} className="rounded-lg border border-zinc-800 px-4 py-4">
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
                  <p className="text-sm font-mono text-zinc-300">{conv.contactId}</p>
                  {conv.pauseReason && (
                    <p className="text-xs text-amber-500 mt-1">Paused: {conv.pauseReason}</p>
                  )}
                  <p className="text-xs text-zinc-600 mt-1">
                    Updated {new Date(conv.updatedAt).toLocaleString()}
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
          ))}
        </div>
      </div>
    </div>
  )
}
