import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

/**
 * GET — minimal "who am I" for client components that need to filter
 * lists by current user (e.g. inbox "Mine" tab). Returns just id, name,
 * email, image — never sensitive fields.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ user: null }, { status: 200 })
  }
  return NextResponse.json({
    user: {
      id: session.user.id,
      name: session.user.name ?? null,
      email: session.user.email ?? null,
      image: (session.user as any).image ?? null,
    },
  })
}
