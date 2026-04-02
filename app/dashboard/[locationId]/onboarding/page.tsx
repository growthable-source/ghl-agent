import { db } from '@/lib/db'
import { redirect } from 'next/navigation'
import OnboardingWizard from '@/components/dashboard/OnboardingWizard'

export default async function OnboardingPage({
  params,
}: {
  params: Promise<{ locationId: string }>
}) {
  const { locationId } = await params
  const location = await db.location.findUnique({ where: { id: locationId } })
  if (!location) redirect('/dashboard')
  if (location.onboardingCompletedAt) redirect(`/dashboard/${locationId}`)
  return <OnboardingWizard locationId={locationId} />
}
