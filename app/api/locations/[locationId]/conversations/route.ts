import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

type Params = { params: Promise<{ locationId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { locationId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const { searchParams } = new URL(req.url)
  const state = searchParams.get('state')

  const conversations = await db.conversationStateRecord.findMany({
    where: {
      locationId,
      ...(state ? { state: state as 'ACTIVE' | 'PAUSED' | 'COMPLETED' } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })

  return NextResponse.json({ conversations })
}
