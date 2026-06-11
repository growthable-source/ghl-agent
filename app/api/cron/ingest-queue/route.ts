import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { ingestSource } from '@/lib/ingest/pipeline'

/**
 * Background worker for queued knowledge ingestion.
 *
 * The "paste any link / drop a file" flow returns instantly after
 * writing an IngestionRun with status='queued'. This cron (every
 * minute) claims queued runs race-proof — UPDATE … WHERE status=
 * 'queued' (same compare-and-swap pattern as process-simulations) —
 * and executes the full pipeline (discover → fetch → chunk →
 * classify → embed) with the pre-created run id, so the UI's
 * polling sees one continuous run from queue to completion.
 *
 * Two runs per tick, sequential: a big docs crawl can take minutes,
 * and the hourly recrawl cron already handles steady-state load.
 * maxDuration matches the pipeline's own ceiling.
 */

export const maxDuration = 300

const RUNS_PER_TICK = 2

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const results: Array<{ runId: string; status: string }> = []

  for (let i = 0; i < RUNS_PER_TICK; i++) {
    const next = await db.ingestionRun.findFirst({
      where: { status: 'queued' },
      orderBy: { startedAt: 'asc' },
      select: { id: true, sourceId: true },
    })
    if (!next) break

    // Compare-and-swap claim: if another invocation grabbed it
    // between SELECT and UPDATE, count stays 0 and we move on.
    const claimed = await db.ingestionRun.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    })
    if (claimed.count === 0) continue

    try {
      const result = await ingestSource(next.sourceId, { runId: next.id })
      results.push({ runId: next.id, status: result.status })
    } catch (err) {
      console.error(`[ingest-queue] run ${next.id} threw:`, err)
      await db.ingestionRun
        .update({
          where: { id: next.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            errorLog: [{ stage: 'pipeline', message: err instanceof Error ? err.message : String(err) }],
          },
        })
        .catch(() => undefined)
      results.push({ runId: next.id, status: 'failed' })
    }
  }

  return NextResponse.json({ ok: true, processed: results })
}
