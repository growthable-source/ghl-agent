import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordCronRun } from '@/lib/cron-heartbeat'

/**
 * GET /api/cron/recrawl
 *
 * Vercel cron entry point. Wakes hourly, finds sources whose
 * (lastCrawledAt + recrawlIntervalDays) is in the past, and ENQUEUES an
 * IngestionRun for each — it never runs the pipeline inline.
 *
 * Why enqueue-only: this cron used to call ingestSource() directly with
 * no soft deadline. A big source (a 1,800-page docs crawl) blew past
 * maxDuration, the function was killed mid-flight, the run rotted as a
 * zombie until the ingest-queue reaper failed it, and lastCrawledAt never
 * advanced — so the same source re-ran EVERY hour forever, and every
 * other due source starved behind it. The ingest-queue worker already has
 * the machinery this needs (soft deadline, graceful 'partial' finish,
 * continuation runs), so all execution belongs there.
 */
export const maxDuration = 60

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

  const results: Array<{ sourceId: string; status: 'queued' | 'already_active' }> = []
  for (const s of due) {
    // One in-flight run per source: if a queued/running run already
    // exists (a continuation mid-crawl, or last hour's enqueue still
    // working), don't stack another on top of it.
    const active = await db.ingestionRun.findFirst({
      where: { sourceId: s.id, status: { in: ['queued', 'running'] } },
      select: { id: true },
    })
    if (active) {
      results.push({ sourceId: s.id, status: 'already_active' })
      continue
    }
    await db.ingestionRun.create({ data: { sourceId: s.id, status: 'queued' } })
    results.push({ sourceId: s.id, status: 'queued' })
  }

  await recordCronRun('recrawl', true)
  return NextResponse.json({ checked: candidates.length, enqueued: results.filter(r => r.status === 'queued').length, results })
}
