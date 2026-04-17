import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { nextRunAt } from '@/lib/crawler'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

const FREQUENCIES = ['daily', 'weekly', 'monthly'] as const

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const schedules = await db.crawlSchedule.findMany({
      where: { agentId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ schedules })
  } catch {
    return NextResponse.json({ schedules: [], notMigrated: true })
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const frequency = body.frequency
  if (!url || !/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'Valid URL required' }, { status: 400 })
  }
  if (!FREQUENCIES.includes(frequency)) {
    return NextResponse.json({ error: 'frequency must be daily, weekly, or monthly' }, { status: 400 })
  }

  try {
    const schedule = await db.crawlSchedule.create({
      data: {
        agentId,
        url,
        frequency,
        nextRunAt: nextRunAt(frequency),
      },
    })
    return NextResponse.json({ schedule })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
