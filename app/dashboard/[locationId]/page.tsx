import Link from 'next/link'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** Short channel labels for pills */
const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS',
  WhatsApp: 'WhatsApp',
  Email: 'Email',
  FB: 'Facebook',
  IG: 'Instagram',
  GMB: 'Google',
  Live_Chat: 'Live Chat',
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default async function LocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const location = await db.location.findUnique({
    where: { id: locationId },
    include: {
      agents: {
        include: {
          channelDeployments: { where: { isActive: true }, select: { channel: true } },
          _count: {
            select: {
              messageLogs: true,
              conversationStates: true,
              knowledgeEntries: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!location) notFound()

  // Get last message time per agent in one query
  const lastMessages = await db.messageLog.groupBy({
    by: ['agentId'],
    where: { locationId, agentId: { not: null } },
    _max: { createdAt: true },
  })
  const lastMessageMap = new Map(
    lastMessages.map(m => [m.agentId, m._max.createdAt])
  )

  // Get active conversation counts per agent
  const activeConvos = await db.conversationStateRecord.groupBy({
    by: ['agentId'],
    where: { locationId, state: 'ACTIVE' },
    _count: true,
  })
  const activeConvoMap = new Map(
    activeConvos.map(c => [c.agentId, c._count])
  )

  // 7-day stats
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const [agentCount, recentMessages, recentSuccess, totalTokens] = await Promise.all([
    db.agent.count({ where: { locationId, isActive: true } }),
    db.messageLog.count({ where: { locationId, createdAt: { gte: sevenDaysAgo } } }),
    db.messageLog.count({ where: { locationId, status: 'SUCCESS', createdAt: { gte: sevenDaysAgo } } }),
    db.messageLog.aggregate({ where: { locationId, createdAt: { gte: sevenDaysAgo } }, _sum: { tokensUsed: true } }),
  ])
  const successRate = recentMessages > 0 ? Math.round((recentSuccess / recentMessages) * 100) : 0

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Agents</h1>
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/${locationId}/logs`} className="text-sm text-zinc-400 hover:text-white transition-colors">
              Logs
            </Link>
            <Link
              href={`/dashboard/${locationId}/playground`}
              className="inline-flex items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 font-medium text-sm h-9 px-4 hover:border-zinc-500 hover:text-white transition-colors"
            >
              Playground
            </Link>
            <Link
              href={`/dashboard/${locationId}/agents/new`}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors"
            >
              New Agent
            </Link>
          </div>
        </div>

        {/* Stats — scoped to last 7 days */}
        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Agents', value: agentCount, sub: '' },
            { label: 'Messages (7d)', value: recentMessages.toLocaleString(), sub: '' },
            { label: 'Success Rate (7d)', value: `${successRate}%`, sub: '' },
            { label: 'Tokens (7d)', value: (totalTokens._sum.tokensUsed ?? 0).toLocaleString(), sub: '' },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-800 px-4 py-4">
              <p className="text-2xl font-semibold mb-1">{stat.value}</p>
              <p className="text-xs text-zinc-500">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Agent list */}
        {location.agents.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 p-12 text-center">
            <p className="text-zinc-400 mb-2">No agents yet</p>
            <p className="text-zinc-600 text-sm mb-6">
              Create an agent to start handling messages across SMS, WhatsApp, email, and more.
            </p>
            <Link
              href={`/dashboard/${locationId}/agents/new`}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors"
            >
              Create First Agent
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {location.agents.map((agent) => {
              const channels = agent.channelDeployments.map(d => d.channel)
              const lastMsg = lastMessageMap.get(agent.id)
              const activeCount = activeConvoMap.get(agent.id) ?? 0
              const hasVoice = !!agent.calendarId // rough proxy — agents with calendars tend to have voice

              return (
                <Link
                  key={agent.id}
                  href={`/dashboard/${locationId}/agents/${agent.id}`}
                  className="block rounded-xl border border-zinc-800 px-5 py-4 hover:border-zinc-600 transition-colors"
                >
                  {/* Row 1: Name + Status */}
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${agent.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                      <p className="font-medium text-sm">{agent.name}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        agent.isActive
                          ? 'bg-emerald-900/30 text-emerald-400'
                          : 'bg-zinc-800 text-zinc-500'
                      }`}>
                        {agent.isActive ? 'Live' : 'Inactive'}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-xs text-zinc-500">
                      {lastMsg && (
                        <span>Last active {timeAgo(lastMsg)}</span>
                      )}
                      <span className="text-zinc-700">→</span>
                    </div>
                  </div>

                  {/* Row 2: Channels */}
                  <div className="flex items-center gap-2 mb-2.5">
                    {channels.length > 0 ? (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {channels.map(ch => (
                          <span key={ch} className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400">
                            {CHANNEL_LABELS[ch] ?? ch}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">No channels deployed</span>
                    )}
                  </div>

                  {/* Row 3: Metrics */}
                  <div className="flex items-center gap-5 text-xs">
                    <span className="text-zinc-500">
                      <span className="text-zinc-300 font-medium">{agent._count.messageLogs}</span> messages
                    </span>
                    {activeCount > 0 && (
                      <span className="text-zinc-500">
                        <span className="text-zinc-300 font-medium">{activeCount}</span> active conversations
                      </span>
                    )}
                    <span className="text-zinc-500">
                      <span className="text-zinc-300 font-medium">{agent._count.knowledgeEntries}</span> knowledge
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
