import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { runSimulation } from '@/lib/simulator'

export const dynamic = 'force-dynamic'
// 120s lets one sim complete fully inside a single invocation. The cron
// fires every minute, so the next tick picks up the next queued sim
// even if this one took the full window.
export const maxDuration = 120

/**
 * Background worker for queued simulations.
 *
 * Runs every minute via Vercel Cron. Pulls the SINGLE oldest queued sim
 * (FIFO across all swarms), runs it to completion, and updates the
 * owning swarm's counters. One-per-tick = 60/hour = 1440/day. If
 * throughput isn't enough we can either (a) crank up cron frequency or
 * (b) process multiple per tick — we stick to one for now to keep
 * Anthropic rate-limit risk manageable.
 *
 * Secured by CRON_SECRET (shared pattern with the other crons).
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  const provided = req.nextUrl.searchParams.get('secret')
    ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
    ?? ''
  if (provided !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Claim the oldest queued sim by flipping it to running in one UPDATE.
  // Using updateMany + take-one pattern because Prisma doesn't have
  // SELECT FOR UPDATE SKIP LOCKED, so we race-protect by ID via the
  // status filter — if two workers race, only one sees status='queued'
  // when it tries to update.
  const next = await db.simulation.findFirst({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, swarmId: true },
  })
  if (!next) {
    return NextResponse.json({ ok: true, picked: 0, reason: 'no queued simulations' })
  }

  const claim = await db.simulation.updateMany({
    where: { id: next.id, status: 'queued' },
    data: { status: 'running', startedAt: new Date() },
  })
  if (claim.count === 0) {
    // Someone else got it. Not an error — just skip this tick.
    return NextResponse.json({ ok: true, picked: 0, reason: 'lost the race' })
  }

  // If this sim is part of a swarm, flip the swarm to running on its
  // first claimed sim.
  if (next.swarmId) {
    await db.simulationSwarm.updateMany({
      where: { id: next.swarmId, status: 'queued' },
      data: { status: 'running' },
    }).catch(() => {})
  }

  let ok = true
  try {
    await runSimulation(next.id)
  } catch (err: any) {
    ok = false
    console.error(`[CronSim] ${next.id} failed:`, err?.message)
  }

  // Update swarm counters after each sim regardless of outcome. Using
  // a single aggregate query keeps the counters in sync with reality
  // even if multiple workers ever ran concurrently.
  if (next.swarmId) {
    const agg = await db.simulation.groupBy({
      by: ['status'],
      where: { swarmId: next.swarmId },
      _count: { _all: true },
    })
    const byStatus = new Map(agg.map(a => [a.status, a._count._all]))
    const complete = byStatus.get('complete') ?? 0
    const failed = byStatus.get('failed') ?? 0
    const queued = byStatus.get('queued') ?? 0
    const running = byStatus.get('running') ?? 0

    await db.simulationSwarm.update({
      where: { id: next.swarmId },
      data: {
        totalComplete: complete,
        totalFailed: failed,
        // Swarm is complete when nothing is queued or running anymore.
        status: (queued + running) === 0 ? 'complete' : 'running',
      },
    }).catch(() => {})
  }

  return NextResponse.json({
    ok,
    picked: 1,
    simulationId: next.id,
    swarmId: next.swarmId,
  })
}
