import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import OnboardingWizard from '@/components/dashboard/OnboardingWizard'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const location = await db.location.findUnique({ where: { id: workspaceId } })
  if (!location) redirect('/dashboard')
  if (location.onboardingCompletedAt) redirect(`/dashboard/${workspaceId}`)
  return <OnboardingWizard workspaceId={workspaceId} />
}
