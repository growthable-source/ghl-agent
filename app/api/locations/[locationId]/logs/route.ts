import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest, { params }: { params: Promise<{ locationId: string }> }) {
  const { locationId } = await params
  const { searchParams } = new URL(req.url)
  const page = parseInt(searchParams.get('page') ?? '1')
  const limit = parseInt(searchParams.get('limit') ?? '25')
  const skip = (page - 1) * limit

  const [logs, total] = await Promise.all([
    db.messageLog.findMany({
      where: { locationId },
      include: { agent: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.messageLog.count({ where: { locationId } }),
  ])

  return NextResponse.json({ logs, total, page, limit, pages: Math.ceil(total / limit) })
}
