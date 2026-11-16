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

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } })
  if (!workspace) notFound()

  const agents = await db.agent.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-tight text-text-primary mb-1">Playground</h1>
        <p className="text-[13px] text-text-tertiary">Send test messages to any agent and see exactly how it responds.</p>
      </div>
      {/* Mode switcher. Compare (side-by-side agents) and Scenario runs (saved
          scenarios + scoring) need runtime support that doesn't exist yet. */}
      {/* TODO(redesign-followup): Compare + Scenario runs modes, Save as scenario, Trace sidebar (knowledge/rule/tool/model timeline), per-reply Eval score + latency. */}
      <div className="inline-flex items-center rounded-md bg-surface-secondary p-0.5 mb-4" role="group" aria-label="Playground mode">
        <span className="h-7 px-2.5 inline-flex items-center rounded text-[12px] font-medium bg-surface text-text-primary shadow-sm">Single chat</span>
        <span className="h-7 px-2.5 inline-flex items-center rounded text-[12px] font-medium text-text-muted cursor-not-allowed" title="Coming soon" aria-disabled="true">Compare</span>
        <span className="h-7 px-2.5 inline-flex items-center rounded text-[12px] font-medium text-text-muted cursor-not-allowed" title="Coming soon" aria-disabled="true">Scenario runs</span>
      </div>
      <PlaygroundPanel workspaceId={workspaceId} agents={agents} defaultAgentId={defaultAgentId} />
    </div>
  )
}
