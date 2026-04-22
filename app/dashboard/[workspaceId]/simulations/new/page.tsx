import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import NewSimulationForm from '@/components/dashboard/NewSimulationForm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

export default async function NewSimulationPage({ params }: Params) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const { workspaceId } = await params

  const agents = await db.agent.findMany({
    where: {
      OR: [{ workspaceId }, { location: { workspaceId } }],
      isActive: true,
    },
    select: { id: true, name: true },
    orderBy: { createdAt: 'desc' },
  })

  return (
    <div className="p-8 max-w-3xl space-y-6">
      <div>
        <Link href={`/dashboard/${workspaceId}/simulations`} className="text-xs text-zinc-500 hover:text-white">
          ← Simulations
        </Link>
        <h1 className="text-xl font-semibold mt-2">New simulation</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-xl">
          Describe who the fake customer is and how they should behave. We&apos;ll
          run a multi-turn conversation against your agent and review the
          result for improvements.
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          You don&apos;t have any active agents in this workspace yet. Create one
          first, then come back to run simulations against it.
        </div>
      ) : (
        <NewSimulationForm workspaceId={workspaceId} agents={agents} />
      )}
    </div>
  )
}
