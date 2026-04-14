import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import PlaygroundPanel from '@/components/dashboard/PlaygroundPanel'

export const dynamic = 'force-dynamic'

export default async function PlaygroundPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspaceId: string }>
  searchParams: Promise<{ agentId?: string }>
}) {
  const { workspaceId } = await params
  const { agentId: defaultAgentId } = await searchParams

  const location = await db.location.findUnique({ where: { id: workspaceId } })
  if (!location) notFound()

  const agents = await db.agent.findMany({
    where: { locationId: workspaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="p-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-1">Playground</h1>
        <p className="text-zinc-400 text-sm">Send test messages to any agent and see exactly how it responds.</p>
      </div>
      <PlaygroundPanel workspaceId={workspaceId} agents={agents} defaultAgentId={defaultAgentId} />
    </div>
  )
}
