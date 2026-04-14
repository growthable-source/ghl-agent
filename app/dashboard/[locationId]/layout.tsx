import { redirect, notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

/**
 * Location-level layout — enforces that the current user has access to
 * this location via a UserLocation record. Runs before ALL child pages
 * under /dashboard/[locationId]/*.
 */
export default async function LocationLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locationId: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { locationId } = await params

  // Check that this user has access to this location
  const access = await db.userLocation.findUnique({
    where: {
      userId_locationId: {
        userId: session.user.id,
        locationId,
      },
    },
    select: { id: true },
  })

  if (!access) {
    // User doesn't have access — check if the location even exists
    const exists = await db.location.findUnique({
      where: { id: locationId },
      select: { id: true },
    })

    if (!exists) notFound()

    // Location exists but user doesn't have access — send them to dashboard
    redirect('/dashboard')
  }

  return <>{children}</>
}
