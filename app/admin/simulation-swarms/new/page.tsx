import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull, roleHas } from '@/lib/admin-auth'
import NewSwarmForm from '@/components/admin/NewSwarmForm'

export const dynamic = 'force-dynamic'

export default async function NewSwarmPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')
  if (!roleHas(session.role, 'admin')) redirect('/admin/simulation-swarms')

  // Fetch all active agents across all workspaces — swarms are admin-wide.
  const agents = await db.agent.findMany({
    where: { isActive: true },
    select: {
      id: true, name: true,
      workspace: { select: { id: true, name: true } },
      location: { select: { workspace: { select: { id: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  })

  const agentOptions = agents.map(a => ({
    id: a.id,
    name: a.name,
    workspace: a.workspace?.name ?? a.location?.workspace?.name ?? '—',
  }))

  return (
    <div className="p-8 max-w-4xl space-y-6">
      <div>
        <Link href="/admin/simulation-swarms" className="text-xs text-zinc-500 hover:text-white">
          ← Swarms
        </Link>
        <h1 className="text-xl font-semibold mt-2">New simulation swarm</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-xl">
          Queue N simulations at once. Pick one or more agents, define one
          or more personas, and specify how many times to run each
          combination. The processor picks them up one-per-minute.
        </p>
      </div>

      <NewSwarmForm agents={agentOptions} />
    </div>
  )
}
