import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ locationId: string; logId: string }> }
) {
  const { logId } = await params
  const log = await db.messageLog.findUnique({
    where: { id: logId },
    include: { agent: { select: { name: true } } },
  })
  if (!log) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ log })
}
