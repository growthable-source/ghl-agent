import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PATCH(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string }> }
) {
  const { locationId } = await params
  await db.location.update({
    where: { id: locationId },
    data: { onboardingCompletedAt: new Date() },
  })
  return NextResponse.json({ success: true })
}
