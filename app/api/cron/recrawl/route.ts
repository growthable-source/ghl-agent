import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ingestSource } from '@/lib/ingest/pipeline'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * GET /api/cron/recrawl
 *
 * Vercel cron entry point. Wakes hourly, finds sources whose
 * (lastCrawledAt + recrawlIntervalDays) is in the past, and runs
 * the ingest pipeline on each one.
 *
 * Concurrency: 1 source at a time initially. The brief asks for
 * "don't optimise before measuring" — when a single ingest run can
 * comfortably finish inside a cron tick, raising concurrency is a
 * one-line change.
 */
export const maxDuration = 300

const HOUR_MS = 60 * 60 * 1000
const DEFAULT_INTERVAL_DAYS = 7
const MAX_SOURCES_PER_TICK = 5

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let candidates: Array<{ id: string; crawlConfig: any; lastCrawledAt: Date | null }> = []
  try {
    candidates = await (db as any).knowledgeSource.findMany({
      where: { isActive: true },
      orderBy: { lastCrawledAt: 'asc' },
      take: 50,
      select: { id: true, crawlConfig: true, lastCrawledAt: true },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ skipped: 'migration_pending' })
    }
    throw err
  }

  const now = Date.now()
  const due = candidates.filter(s => {
    const intervalDays = Number(s.crawlConfig?.recrawlIntervalDays) || DEFAULT_INTERVAL_DAYS
    const lastMs = s.lastCrawledAt ? new Date(s.lastCrawledAt).getTime() : 0
    return lastMs + intervalDays * 24 * HOUR_MS < now
  }).slice(0, MAX_SOURCES_PER_TICK)

  const results: Array<{ sourceId: string; status: string; chunksCreated: number; chunksSuperseded: number }> = []
  for (const s of due) {
    try {
      const r = await ingestSource(s.id)
      results.push({ sourceId: s.id, status: r.status, chunksCreated: r.chunksCreated, chunksSuperseded: r.chunksSuperseded })
    } catch (err: any) {
      console.warn('[recrawl-cron] ingestSource failed for', s.id, err?.message)
      results.push({ sourceId: s.id, status: 'failed', chunksCreated: 0, chunksSuperseded: 0 })
    }
  }

  await recordCronRun('recrawl', true)
  return NextResponse.json({ checked: candidates.length, ranIngest: results.length, results })
}
