import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireLocationAccess } from '@/lib/require-access'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string; logId: string }> }
) {
  const { locationId, logId } = await params
  const access = await requireLocationAccess(locationId)
  if (access instanceof NextResponse) return access
  const log = await db.messageLog.findUnique({
    where: { id: logId },
    include: { agent: { select: { name: true } } },
  })
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ log })
}
