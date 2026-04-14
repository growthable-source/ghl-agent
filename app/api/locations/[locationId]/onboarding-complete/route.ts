import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  await db.location.update({
    where: { id: locationId },
    data: { onboardingCompletedAt: new Date() },
  })
  return NextResponse.json({ success: true })
}
