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
            <div
              className="w-16 h-16 mx-auto mb-5 rounded-2xl flex items-center justify-center border"
              style={{
                background: 'var(--accent-primary-bg)',
                borderColor: 'var(--accent-primary)',
                color: 'var(--accent-primary)',
              }}
            >
              <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </div>
            <h1 className="text-2xl font-semibold mb-2 tracking-tight" style={{ color: 'var(--text-primary)' }}>Create your first workspace</h1>
            <p className="text-sm max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
              A workspace is where your AI agents, CRM connections, and contacts live.
              You can create separate workspaces for different businesses or clients.
            </p>
          </div>

          <div className="flex justify-center">
            <Link
              href="/dashboard/new"
              className="inline-flex items-center justify-center rounded-lg font-medium text-sm h-11 px-8 transition-colors"
              style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
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
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>Workspaces</h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
              {workspaceMembers.length} of {features.workspaces} workspace{features.workspaces !== 1 ? 's' : ''}
              <span className="mx-1.5" style={{ color: 'var(--text-muted)' }}>&middot;</span>
              {bestPlan.charAt(0).toUpperCase() + bestPlan.slice(1)} plan
            </p>
          </div>
          <div className="flex items-center gap-2">
            {atLimit ? (
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Workspace limit reached</span>
                <Link
                  href={workspaceMembers[0] ? `/dashboard/${workspaceMembers[0].workspaceId}/settings/billing` : '#'}
                  className="text-xs font-medium transition-colors"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  Upgrade
                </Link>
              </div>
            ) : (
              <Link
                href="/dashboard/new"
                className="text-sm font-medium px-4 py-2 rounded-lg transition-colors"
                style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
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
                className="flex items-center justify-between rounded-xl border px-5 py-4 transition-colors group"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <WorkspaceAvatar
                    logoUrl={(ws as any).logoUrl}
                    icon={ws.icon}
                    size={32}
                    title={ws.name}
                    className="bg-surface-secondary border border-border-theme rounded-lg"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>{ws.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{role}</span>
                      {isTrial && trialDaysLeft > 0 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: 'var(--accent-amber-bg)', color: 'var(--accent-amber)' }}
                        >
                          {trialDaysLeft}d trial
                        </span>
                      )}
                      {isTrial && trialDaysLeft === 0 && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }}
                        >
                          Trial expired
                        </span>
                      )}
                      {!isTrial && (
                        <span
                          className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                          style={{ background: 'var(--surface-secondary)', color: 'var(--text-tertiary)' }}
                        >
                          {planLabel}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-6 text-right shrink-0">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ws._count.agents}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>agents</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ws._count.members}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>members</p>
                  </div>
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ws._count.locations}</p>
                    <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>CRMs</p>
                  </div>
                  <span className="transition-colors" style={{ color: 'var(--text-tertiary)' }}>→</span>
                </div>
              </Link>
            )
          })}
        </div>

        {/* Workspace limit info */}
        {isOnFreeTier && !atLimit && (
          <p className="text-center text-xs mt-6" style={{ color: 'var(--text-tertiary)' }}>
            Need more workspaces?{' '}
            <Link
              href={workspaceMembers[0] ? `/dashboard/${workspaceMembers[0].workspaceId}/settings/billing` : '#'}
              className="hover:underline"
              style={{ color: 'var(--accent-primary)' }}
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
