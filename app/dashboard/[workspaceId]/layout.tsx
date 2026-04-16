import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import TrialBanner from '@/components/dashboard/TrialBanner'

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

  return (
    <>
      <TrialBanner workspaceId={workspaceId} />
      {children}
    </>
  )
}
