import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { NextResponse } from 'next/server'

/**
 * Checks that the currently authenticated user has access to the given location.
 * Returns the session if authorized, or a 401/403 NextResponse if not.
 *
 * Usage in API routes:
 * ```ts
 * const access = await requireLocationAccess(locationId)
 * if (access instanceof NextResponse) return access
 * // access.session is now available
 * ```
 */
export async function requireLocationAccess(locationId: string) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const link = await db.userLocation.findUnique({
    where: {
      userId_locationId: {
        userId: session.user.id,
        locationId,
      },
    },
    select: { role: true },
  })

  if (!link) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  return { session, role: link.role }
}
