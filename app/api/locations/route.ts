import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const locations = await db.location.findMany({
    include: { _count: { select: { agents: true, messageLogs: true } } },
    orderBy: { installedAt: 'desc' },
  })
  return NextResponse.json({ locations })
}
