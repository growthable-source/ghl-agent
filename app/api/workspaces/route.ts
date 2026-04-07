import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'

function generateId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { name } = await req.json()
  if (!name?.trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }

  const locationId = `ws_${generateId()}`

  // Create the Location (workspace) and link to user
  await db.location.create({
    data: {
      id: locationId,
      companyId: locationId,
      userId: session.user.id,
      userType: 'Location',
      scope: 'all',
      accessToken: '',
      refreshToken: '',
      refreshTokenId: '',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    },
  })

  await db.userLocation.create({
    data: {
      userId: session.user.id,
      locationId,
      role: 'owner',
    },
  })

  return NextResponse.json({ locationId })
}
