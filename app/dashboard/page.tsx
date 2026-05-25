import Link from 'next/link'
import { headers, cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { getPlanFeatures } from '@/lib/plans'
import { EMBED_SESSION_COOKIE, EMBED_WORKSPACE_COOKIE } from '@/lib/embed-session'
import WorkspaceAvatar from '@/components/dashboard/WorkspaceAvatar'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  // Get workspaces this user has access to. We select the full
  // Locations list (not _count) so the render can dedupe by provider
  // — see "Truthful CRM pills" below.
  const workspaceMembers = await db.workspaceMember.findMany({
    where: { userId: session.user.id },
    include: {
      workspace: {
        include: {
          _count: { select: { agents: true, members: true } },
          locations: { select: { id: true, crmProvider: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  })

  // ─── Lock-to-one-workspace redirects ────────────────────────────────
  // A user with a single workspace shouldn't see a one-card picker —
  // send them straight in. Independently, when this page is loaded
  // inside a CRM iframe (marketplace install Custom Menu Link), the
  // workspace picker is the wrong destination regardless of count:
  // they're locked to whichever Location the CRM is showing. Resolve
  // by preferring a marketplace-installed workspace, falling back to
  // the most-recent.
  //
  // Two iframe signals, OR'd together:
  //   1. Sec-Fetch-Dest: iframe — set by browsers on the INITIAL iframe
  //      document load only. Misses any client-side SPA navigation that
  //      lands the user on /dashboard after the first render.
  //   2. Presence of __Secure-voxility-embed-session cookie — set by
  //      the SSO handshake and persists for 90 days. This is the
  //      durable signal that survives every nav, refresh, and
  //      back-button. Only set when the user came in via the iframe.
  // The first check alone was letting the picker leak whenever a user
  // navigated within the iframe (sidebar logo, breadcrumb, etc).
  const hdrs = await headers()
  const cookieStore = await cookies()
  const hasEmbedCookie = !!cookieStore.get(EMBED_SESSION_COOKIE)
  const inIframe = hdrs.get('sec-fetch-dest') === 'iframe' || hasEmbedCookie
  // The handshake wrote this to bind the iframe session to a specific
  // workspace. It's the source of truth when picking a redirect target
  // — multiple marketplace workspaces (one per GHL sub-account) would
  // otherwise collide and the user could be sent to the wrong one.
  const boundWorkspaceId = cookieStore.get(EMBED_WORKSPACE_COOKIE)?.value

  if (workspaceMembers.length === 1) {
    redirect(`/dashboard/${workspaceMembers[0].workspaceId}`)
  }

  if (inIframe && workspaceMembers.length > 0) {
    // Precedence: bound cookie (the workspace the handshake locked
    // this iframe session to) > any marketplace workspace > most-recent.
    // If the bound cookie points at a workspace the user no longer has
    // access to (rare — install revoked between handshake and now),
    // fall through to the marketplace search.
    const bound = boundWorkspaceId
      ? workspaceMembers.find(m => m.workspaceId === boundWorkspaceId)
      : null
    const marketplace = !bound
      ? workspaceMembers.find(m => (m.workspace as any).installSource === 'ghl_marketplace')
      : null
    const target =
      bound?.workspaceId ?? marketplace?.workspaceId ?? workspaceMembers[0].workspaceId
    redirect(`/dashboard/${target}`)
  }

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
                  {/* CRMs cell — show actual provider names instead of
                      a raw Location count. The old _count.locations
                      tally inflated workspaces with native auto-provisions
                      and placeholder FK stubs (e.g. a single-LeadConnector
                      install reading as "3 CRMs"). Dedupe by provider
                      and label friendly. */}
                  {(() => {
                    const labelFor = (p: string) =>
                      p === 'ghl' ? 'LeadConnector'
                      : p === 'hubspot' ? 'HubSpot'
                      : p === 'native' ? 'Native'
                      : p
                    const providers = Array.from(new Set(
                      (ws as any).locations
                        .filter((l: { id: string; crmProvider: string }) =>
                          !l.id.startsWith('placeholder:') && l.crmProvider !== 'none',
                        )
                        .map((l: { crmProvider: string }) => labelFor(l.crmProvider)),
                    )) as string[]
                    return (
                      <div className="text-right max-w-[180px]">
                        {providers.length > 0 ? (
                          <div className="flex flex-wrap gap-1 justify-end">
                            {providers.map(p => (
                              <span
                                key={p}
                                className="text-[10px] font-medium px-1.5 py-0.5 rounded"
                                style={{ background: 'var(--surface-secondary)', color: 'var(--text-secondary)' }}
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Not connected</p>
                        )}
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {providers.length === 1 ? 'CRM' : 'CRMs'}
                        </p>
                      </div>
                    )
                  })()}
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
