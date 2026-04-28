import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getPlanFeatures } from '@/lib/plans'
import WorkspaceAvatar from '@/components/dashboard/WorkspaceAvatar'

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
          _count: { select: { agents: true, locations: true, members: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // Determine the *effective* plan for this user — billing is account-
  // level (the user's best plan across all owned workspaces), not
  // per-workspace. Every row inherits this; no workspace shows its own
  // trial-expired badge once any of the user's workspaces is on a paid
  // plan.
  const ownedWorkspaces = workspaceMembers.filter(m => m.role === 'owner').map(m => m.workspace)
  const sourceForPlan = ownedWorkspaces.length > 0 ? ownedWorkspaces : workspaceMembers.map(m => m.workspace)
  const plans = sourceForPlan.map(w => w.plan)
  const bestPlan = (['scale', 'growth', 'starter', 'trial'] as const).find(p => plans.includes(p)) || 'trial'
  // Latest trialEndsAt across the source so a freshly-created trial
  // workspace doesn't accidentally extend the timer for an old one.
  const latestTrialEndsAt = sourceForPlan
    .filter(w => w.plan === 'trial' && w.trialEndsAt)
    .reduce<Date | null>((latest, w) => {
      const t = w.trialEndsAt!
      return !latest || t > latest ? t : latest
    }, null)
  const trialDaysLeftAccount = latestTrialEndsAt
    ? Math.max(0, Math.ceil((new Date(latestTrialEndsAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : 0
  const features = getPlanFeatures(bestPlan)
  const atLimit = workspaceMembers.length >= features.workspaces
  const isOnFreeTier = bestPlan === 'trial' || bestPlan === 'starter'

  // No workspaces — show create prompt
  if (workspaceMembers.length === 0) {
    return (
      <div className="p-8">
        <div className="max-w-2xl mx-auto mt-12">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto mb-5 rounded-2xl bg-gradient-to-br from-[#fa4d2e]/20 to-[#fa4d2e]/5 flex items-center justify-center border border-[#fa4d2e]/20">
              <svg className="w-7 h-7 text-[#fa4d2e]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold mb-2">Create your first workspace</h1>
            <p className="text-zinc-400 text-sm max-w-md mx-auto">
              A workspace is where your AI agents, CRM connections, and contacts live.
              You can create separate workspaces for different businesses or clients.
            </p>
          </div>

          <div className="flex justify-center">
            <Link
              href="/dashboard/new"
              className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-11 px-8 hover:bg-zinc-200 transition-colors"
            >
              Create Workspace
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Multiple workspaces — show listing
  return (
    <div className="p-8">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold">Workspaces</h1>
            <p className="text-zinc-500 text-xs mt-0.5">
              {workspaceMembers.length} of {features.workspaces} workspace{features.workspaces !== 1 ? 's' : ''}
              <span className="text-zinc-700 mx-1.5">&middot;</span>
              {bestPlan.charAt(0).toUpperCase() + bestPlan.slice(1)} plan
            </p>
          </div>
          <div className="flex items-center gap-2">
            {atLimit ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Workspace limit reached</span>
                <Link
                  href={workspaceMembers[0] ? `/dashboard/${workspaceMembers[0].workspaceId}/settings/billing` : '#'}
                  className="text-xs font-medium text-[#fa4d2e] hover:text-[#fa4d2e]/80 transition-colors"
                >
                  Upgrade
                </Link>
              </div>
            ) : (
              <Link
                href="/dashboard/new"
                className="text-sm bg-white text-black font-medium px-4 py-2 rounded-lg hover:bg-zinc-200 transition-colors"
              >
                + New Workspace
              </Link>
            )}
          </div>
        </div>

        <div className="space-y-3">
          {workspaceMembers.map(({ workspace: ws, role }) => {
            // Badges reflect the OWNER'S effective plan — not this row's
            // workspace.plan — so a Scale account doesn't see "Trial
            // expired" on workspace #2..#N.
            const planLabel = bestPlan.charAt(0).toUpperCase() + bestPlan.slice(1)
            const isTrial = bestPlan === 'trial'
            const trialDaysLeft = trialDaysLeftAccount

            return (
              <Link
                key={ws.id}
                href={`/dashboard/${ws.id}`}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-950 px-5 py-4 hover:border-zinc-600 transition-colors group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <WorkspaceAvatar
                    logoUrl={(ws as any).logoUrl}
                    icon={ws.icon}
                    size={32}
                    title={ws.name}
                    className="bg-zinc-900 border border-zinc-800 rounded-lg"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{ws.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-zinc-600 text-xs">{role}</span>
                      {isTrial && trialDaysLeft > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-900/30 text-amber-400 font-medium">
                          {trialDaysLeft}d trial
                        </span>
                      )}
                      {isTrial && trialDaysLeft === 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-medium">
                          Trial expired
                        </span>
                      )}
                      {!isTrial && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-medium">
                          {planLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <p className="text-sm font-medium">{ws._count.agents}</p>
                    <p className="text-zinc-600 text-[11px]">agents</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{ws._count.members}</p>
                    <p className="text-zinc-600 text-[11px]">members</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium">{ws._count.locations}</p>
                    <p className="text-zinc-600 text-[11px]">CRMs</p>
                  </div>
                  <span className="text-zinc-700 group-hover:text-zinc-400 transition-colors">→</span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Workspace limit info */}
        {isOnFreeTier && !atLimit && (
          <p className="text-center text-xs text-zinc-600 mt-6">
            Need more workspaces?{' '}
            <Link
              href={workspaceMembers[0] ? `/dashboard/${workspaceMembers[0].workspaceId}/settings/billing` : '#'}
              className="text-[#fa4d2e] hover:underline"
            >
              Upgrade your plan
            </Link>
            {' '}for up to {bestPlan === 'trial' ? '10' : '3'} workspaces.
          </p>
        )}
      </div>
    </div>
  )
}
