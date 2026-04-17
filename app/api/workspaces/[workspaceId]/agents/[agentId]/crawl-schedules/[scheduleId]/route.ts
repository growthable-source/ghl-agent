import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { crawlAndIndex, nextRunAt } from '@/lib/crawler'

type Params = { params: Promise<{ workspaceId: string; agentId: string; scheduleId: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId, agentId, scheduleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}

  // ─── Action: run_now ─────────────────────────────────────────
  if (body.action === 'run_now') {
    const schedule = await db.crawlSchedule.findUnique({ where: { id: scheduleId } })
    if (!schedule || schedule.agentId !== agentId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    try {
      const { chunksAdded, chunksSkipped } = await crawlAndIndex({
        agentId,
        url: schedule.url,
        source: 'crawl',
        skipUnchanged: true,
      })
      await db.crawlSchedule.update({
        where: { id: scheduleId },
        data: {
          lastRunAt: new Date(),
          lastStatus: chunksAdded > 0 ? 'success' : 'no_changes',
          lastError: null,
          newChunks: { increment: chunksAdded },
          nextRunAt: nextRunAt(schedule.frequency as any),
        },
      })
      return NextResponse.json({ chunksAdded, chunksSkipped })
    } catch (err: any) {
      await db.crawlSchedule.update({
        where: { id: scheduleId },
        data: { lastRunAt: new Date(), lastStatus: 'failed', lastError: err.message?.slice(0, 500) },
      })
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
  }

  // ─── Plain PATCH ────────────────────────────────────────────
  const schedule = await db.crawlSchedule.update({
    where: { id: scheduleId },
    data: {
      ...(body.isActive !== undefined && { isActive: body.isActive }),
      ...(body.frequency !== undefined && {
        frequency: body.frequency,
        nextRunAt: nextRunAt(body.frequency, new Date()),
      }),
    },
  })
  return NextResponse.json({ schedule })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { workspaceId, scheduleId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  await db.crawlSchedule.delete({ where: { id: scheduleId } })
  return NextResponse.json({ success: true })
}
