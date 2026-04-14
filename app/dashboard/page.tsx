import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  // Get workspaces this user has access to
  const workspaceMembers = await db.workspaceMember.findMany({
    where: { userId: session.user.id },
    include: {
      workspace: {
        include: {
          _count: { select: { agents: true, locations: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // If user has exactly one workspace, go straight to it
  if (workspaceMembers.length === 1) {
    redirect(`/dashboard/${workspaceMembers[0].workspaceId}`)
  }

  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold">Workspaces</h1>
            <p className="text-zinc-400 text-sm mt-1">
              {workspaceMembers.length > 0
                ? `${workspaceMembers.length} workspace${workspaceMembers.length !== 1 ? 's' : ''}`
                : 'No workspaces yet'}
            </p>
          </div>
          <Link href="/dashboard/new" className="text-sm bg-white text-black font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors">
            + New workspace
          </Link>
        </div>

        {workspaceMembers.length === 0 ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-12 text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-zinc-900 flex items-center justify-center">
              <svg className="w-6 h-6 text-zinc-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h2 className="text-lg font-medium mb-2">Create your first workspace</h2>
            <p className="text-zinc-500 text-sm mb-6 max-w-md mx-auto">
              A workspace connects your CRM, calendar, and phone system. Your AI agents live inside it.
            </p>
            <Link href="/dashboard/new" className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-6 hover:bg-zinc-200 transition-colors">
              Get started
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {workspaceMembers.map(({ workspace: ws, role }) => (
              <Link
                key={ws.id}
                href={`/dashboard/${ws.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4 hover:border-zinc-600 transition-colors"
              >
                <div>
                  <p className="font-medium text-sm">{ws.name}</p>
                  <p className="text-zinc-500 text-xs mt-0.5">
                    {role} &middot; Created {new Date(ws.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-sm font-medium">{ws._count.agents}</p>
                    <p className="text-zinc-500 text-xs">agents</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{ws._count.locations}</p>
                    <p className="text-zinc-500 text-xs">locations</p>
                  </div>
                  <span className="text-zinc-600">&rarr;</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
