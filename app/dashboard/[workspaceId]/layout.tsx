import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import TrialBanner from '@/components/dashboard/TrialBanner'
import PauseBanner from '@/components/dashboard/PauseBanner'
import ConnectionHealthBanner from '@/components/dashboard/ConnectionHealthBanner'
import HandoffAlertBanner from '@/components/dashboard/HandoffAlertBanner'
import NewChatAlert from '@/components/dashboard/NewChatAlert'
import EmbeddedWorkspaceBanner from '@/components/dashboard/EmbeddedWorkspaceBanner'
import MobileNav from '@/components/dashboard/MobileNav'
import PresenceHeartbeat from '@/components/dashboard/PresenceHeartbeat'
import SupportSessionBanner from '@/components/dashboard/SupportSessionBanner'
import { findMemberRole, type SupportAwareSession } from '@/lib/support-session'
import { agentPageAllowed, customHostWorkspaceId } from '@/lib/whitelabel/guard'

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

  // White-label domain: only its own workspace is reachable here
  // (lib/whitelabel/guard.ts). '' = a custom host serving no workspace.
  const hostWorkspaceId = await customHostWorkspaceId()
  if (hostWorkspaceId !== null && hostWorkspaceId !== workspaceId) {
    if (hostWorkspaceId) redirect(`/dashboard/${hostWorkspaceId}`)
    notFound()
  }

  // Check that this user has access to this workspace (membership, or a
  // super admin's support session scoped to it — lib/support-session.ts)
  const access = await findMemberRole(session, workspaceId)
  const support = (session as SupportAwareSession).support

  if (!access && hostWorkspaceId) {
    // Signed in on the team's domain but not (or no longer) on the team.
    // The generic fallbacks below would bounce between /dashboard and here.
    redirect('/sign-in?error=no_access')
  }

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

  // Support Agents work the inbox and tickets only (lib/whitelabel/
  // access-policy.ts); the APIs behind every other page refuse them too.
  if (access.role === 'agent' && !(await agentPageAllowed())) {
    redirect(`/dashboard/${workspaceId}/inbox`)
  }

  // Empty-workspace auto-launch lives in page.tsx now — `params` is
  // a reliable "we're on the workspace root" signal, while the
  // headers-based path detection we used here was Next.js-runtime-
  // specific and could silently no-op on non-Vercel deployments.

  return (
    <>
      {/* Renders only when loaded inside a marketplace iframe — labels
          which CRM sub-account this workspace is bound to so the user
          doesn't think they've been dropped into someone else's data. */}
      {/* Invisible — reports real input to the auto-away heartbeat so
          routing knows who's actually at their desk. */}
      {support?.workspaceId === workspaceId && (
        <SupportSessionBanner workspaceId={workspaceId} adminEmail={support.adminEmail} />
      )}
      <PresenceHeartbeat workspaceId={workspaceId} />
      <EmbeddedWorkspaceBanner workspaceId={workspaceId} />
      {/* Plan/trial upsell is between the workspace and us — never shown
          on the customer's own branded domain. */}
      {!hostWorkspaceId && <TrialBanner workspaceId={workspaceId} />}
      <PauseBanner />
      {/* Loud, persistent alert when one or more agents have paused
          and need a human. Renders nothing when everything is calm.
          Pings the inbox notification sound the moment a NEW pause
          appears so operators on another tab/page actually hear it. */}
      <HandoffAlertBanner />
      <ConnectionHealthBanner workspaceId={workspaceId} />
      {/* This wrapper must PASS THROUGH the bounded-height flex chain the
          dashboard layout sets up (h-screen main → scrolling children
          wrapper), or full-viewport pages like the inbox can't pin their
          composer — as a plain block it was the missing link that let the
          inbox grow past the viewport, forcing operators to scroll down to
          find the reply box.
          md:min-h-0 is the load-bearing piece: a flex item's automatic
          minimum height is its CONTENT height, so without it this wrapper
          measured 7,737px tall on a long conversation (verified with
          live DOM inspection) and flex-1 could never shrink it — the
          composer sat thousands of px below the fold. With min-h-0 the
          wrapper clamps to the space left under the banners; the inbox
          (overflow-hidden root) scrolls internally, and ordinary content
          pages simply overflow into the outer scroller as before.
          Mobile keeps natural height (no min-h-0 below md) so the pb-16
          MobileNav clearance stays after the content. */}
      <div className="pb-16 md:pb-0 flex-1 flex flex-col md:min-h-0">{children}</div>
      {/* Friendly on-screen popup when a NEW live chat comes in — pairs
          with the notification ping so an incoming chat is hard to miss
          even when the operator is on another page. */}
      <NewChatAlert />
      <MobileNav />
    </>
  )
}
