import Link from 'next/link'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function LocationPage({ params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const location = await db.location.findUnique({
    where: { id: locationId },
    include: {
      agents: {
        include: { _count: { select: { knowledgeEntries: true, routingRules: true, messageLogs: true } } },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!location) notFound()

  const [agentCount, messageCount, successCount, tokenSum] = await Promise.all([
    db.agent.count({ where: { locationId, isActive: true } }),
    db.messageLog.count({ where: { locationId } }),
    db.messageLog.count({ where: { locationId, status: 'SUCCESS' } }),
    db.messageLog.aggregate({ where: { locationId }, _sum: { tokensUsed: true } }),
  ])
  const successRate = messageCount > 0 ? Math.round((successCount / messageCount) * 100) : 0
  const totalTokens = tokenSum._sum.tokensUsed ?? 0

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">Agents</h1>
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/${locationId}/logs`} className="text-sm text-zinc-400 hover:text-white transition-colors">
              View Logs
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

        <div className="grid grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Active Agents', value: agentCount },
            { label: 'Messages Handled', value: messageCount },
            { label: 'Reply Rate', value: `${successRate}%` },
            { label: 'Tokens Used', value: totalTokens.toLocaleString() },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border border-zinc-800 px-4 py-4">
              <p className="text-2xl font-semibold mb-1">{stat.value}</p>
              <p className="text-xs text-zinc-500">{stat.label}</p>
            </div>
          ))}
        </div>

        {location.agents.length === 0 ? (
          <div className="rounded-lg border border-zinc-800 p-12 text-center">
            <p className="text-zinc-400 mb-2">No agents yet.</p>
            <p className="text-zinc-600 text-sm mb-6">Create an agent to start handling inbound SMS.</p>
            <Link
              href={`/dashboard/${locationId}/agents/new`}
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-9 px-4 hover:bg-zinc-200 transition-colors"
            >
              Create First Agent
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {location.agents.map((agent) => (
              <Link
                key={agent.id}
                href={`/dashboard/${locationId}/agents/${agent.id}`}
                className="flex items-center justify-between rounded-lg border border-zinc-800 px-5 py-4 hover:border-zinc-600 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span className={`w-2 h-2 rounded-full ${agent.isActive ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                  <div>
                    <p className="font-medium text-sm">{agent.name}</p>
                    <p className="text-zinc-500 text-xs mt-0.5 line-clamp-1">{agent.systemPrompt.slice(0, 80)}…</p>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-medium">{agent._count.routingRules}</p>
                    <p className="text-zinc-500 text-xs">rules</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{agent._count.knowledgeEntries}</p>
                    <p className="text-zinc-500 text-xs">knowledge</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{agent._count.messageLogs}</p>
                    <p className="text-zinc-500 text-xs">messages</p>
                  </div>
                  <span className="text-zinc-600">→</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
