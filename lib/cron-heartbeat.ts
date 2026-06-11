/**
 * Cron heartbeats — the answer to "a cron can silently stop and
 * nobody finds out for hours."
 *
 * Every cron records one row per run: success bumps lastSuccessAt and
 * zeroes the failure streak; failure stores the error and increments
 * it. The /api/admin/cron-health endpoint then has ground truth for
 * "which background jobs are stale or failing" — without this, the
 * only signal a cron died (Vercel config drift, a deploy breaking an
 * import, OOM) was customers noticing tokens expiring or messages
 * not sending.
 *
 * recordCronRun never throws and never blocks the cron's real work —
 * a heartbeat failure must not take down the job it's monitoring.
 * Table is hand-applied per repo convention (see migration SQL).
 */

import { db } from '@/lib/db'

export async function recordCronRun(name: string, ok: boolean, error?: string): Promise<void> {
  const now = new Date()
  try {
    await db.cronHeartbeat.upsert({
      where: { name },
      create: {
        name,
        lastRunAt: now,
        lastSuccessAt: ok ? now : null,
        lastError: ok ? null : (error ?? 'unknown').slice(0, 1000),
        consecutiveFailures: ok ? 0 : 1,
      },
      update: {
        lastRunAt: now,
        ...(ok
          ? { lastSuccessAt: now, lastError: null, consecutiveFailures: 0 }
          : { lastError: (error ?? 'unknown').slice(0, 1000), consecutiveFailures: { increment: 1 } }),
      },
    })
  } catch (err) {
    // Table missing (migration pending) or DB blip — log and move on.
    console.warn(`[cron-heartbeat] could not record ${name}:`, err instanceof Error ? err.message : err)
  }
}

/**
 * Wrap a cron handler body: records success/failure automatically and
 * re-reports the result. Usage inside a route handler, after auth:
 *
 *   return withCronHeartbeat('refresh-tokens', async () => {
 *     ...work...
 *     return NextResponse.json({ ok: true })
 *   })
 */
export async function withCronHeartbeat<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    const result = await fn()
    await recordCronRun(name, true)
    return result
  } catch (err) {
    await recordCronRun(name, false, err instanceof Error ? err.message : String(err))
    throw err
  }
}
