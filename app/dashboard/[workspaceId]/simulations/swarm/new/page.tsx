import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import NewSwarmForm from '@/components/dashboard/CustomerSwarmForm'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * Customer-side swarm creation page.
 *
 * One agent × all personas in a single click. The form is intentionally
 * simpler than the admin matrix surface (no agent multi-select, no
 * per-persona configuration). Power users can still run fine-grained
 * bespoke sims via the admin path; this is the "just give me broad
 * coverage against this one agent" shortcut.
 */
export default async function NewCustomerSwarmPage({ params }: Params) {
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
        <h1 className="text-xl font-semibold mt-2">Simulation swarm</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-xl">
          Run one scenario across every customer-persona at once. Pick an
          agent, write the scenario, and we&apos;ll spin up a friendly, an
          aggressive, a price-shopper, and four more — each having the
          same conversation in parallel. Great for broad coverage before
          going live.
        </p>
      </div>

      {agents.length === 0 ? (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm text-amber-300">
          You don&apos;t have any active agents in this workspace yet. Create
          one first, then come back to swarm-test it.
        </div>
      ) : (
        <NewSwarmForm workspaceId={workspaceId} agents={agents} />
      )}
    </div>
  )
}
