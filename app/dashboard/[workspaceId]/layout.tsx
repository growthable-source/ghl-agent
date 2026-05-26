import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import TrialBanner from '@/components/dashboard/TrialBanner'
import PauseBanner from '@/components/dashboard/PauseBanner'
import ConnectionHealthBanner from '@/components/dashboard/ConnectionHealthBanner'
import HandoffAlertBanner from '@/components/dashboard/HandoffAlertBanner'
import EmbeddedWorkspaceBanner from '@/components/dashboard/EmbeddedWorkspaceBanner'
import MobileNav from '@/components/dashboard/MobileNav'

/**
 * Workspace-level layout — enforces that the current user has access to
 * this workspace via a WorkspaceMember record. Runs before ALL child pages
 * under /dashboard/[workspaceId]/*.
 */
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { workspaceId } = await params

  // Check that this user has access to this workspace
  const access = await db.workspaceMember.findUnique({
    where: {
      userId_workspaceId: {
        userId: session.user.id,
        workspaceId,
      },
    },
    select: { id: true },
  })

  if (!access) {
    // User doesn't have access — check if the workspace even exists
    const exists = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true },
    })

    if (!exists) {
      // Maybe this is a legacy Location ID — check if there's a Location with this ID
      // and redirect to its parent workspace
      const location = await db.location.findUnique({
        where: { id: workspaceId },
        select: { workspaceId: true },
      })
      if (location?.workspaceId) {
        redirect(`/dashboard/${location.workspaceId}`)
      }

      // Also check if user has any workspace at all — redirect there
      const membership = await db.workspaceMember.findFirst({
        where: { userId: session.user.id },
        select: { workspaceId: true },
      })
      if (membership) {
        redirect(`/dashboard/${membership.workspaceId}`)
      }

      notFound()
    }

    // Workspace exists but user doesn't have access — send them to dashboard
    redirect('/dashboard')
  }

  // ─── Empty-workspace auto-launch ─────────────────────────────────────
  // A workspace with zero agents has no useful dashboard to show. Send
  // the user straight into the agent-creation wizard so the empty
  // dashboard isn't a dead end. The redirect ONLY fires on the
  // workspace root path — any other child page (Integrations, Settings,
  // /agents/new itself) still renders normally, so the user can navigate
  // around without being looped.
  const h = await headers()
  const path = h.get('x-invoke-path') ?? h.get('x-matched-path') ?? h.get('next-url') ?? ''
  if (path === `/dashboard/${workspaceId}` || path.endsWith(`/dashboard/${workspaceId}/`)) {
    try {
      const agentCount = await db.agent.count({ where: { workspaceId } })
      if (agentCount === 0) {
        redirect(`/dashboard/${workspaceId}/agents/new`)
      }
    } catch (err: any) {
      // Don't block the layout from rendering if the count query fails
      // — the empty-state CTAs on the dashboard are a fine fallback.
      console.warn('[WorkspaceLayout] agent-count check failed:', err?.message)
    }
  }

  return (
    <>
      {/* Renders only when loaded inside a marketplace iframe — labels
          which CRM sub-account this workspace is bound to so the user
          doesn't think they've been dropped into someone else's data. */}
      <EmbeddedWorkspaceBanner workspaceId={workspaceId} />
      <TrialBanner workspaceId={workspaceId} />
      <PauseBanner />
      {/* Loud, persistent alert when one or more agents have paused
          and need a human. Renders nothing when everything is calm.
          Pings the inbox notification sound the moment a NEW pause
          appears so operators on another tab/page actually hear it. */}
      <HandoffAlertBanner />
      <ConnectionHealthBanner workspaceId={workspaceId} />
      <div className="pb-16 md:pb-0">{children}</div>
      <MobileNav />
    </>
  )
}
