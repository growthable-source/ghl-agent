import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import OnboardingWizard from '@/components/dashboard/OnboardingWizard'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  })
  if (!workspace) redirect('/dashboard')
  // Check if any location under this workspace has completed onboarding
  const completedLocation = await db.location.findFirst({
    where: { workspaceId, onboardingCompletedAt: { not: null } },
    select: { id: true },
  })
  if (completedLocation) redirect(`/dashboard/${workspaceId}`)
  return <OnboardingWizard workspaceId={workspaceId} />
}
