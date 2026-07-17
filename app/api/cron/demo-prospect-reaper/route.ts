/**
 * Daily cleanup of expired prospect demos. Deletes the heavy assets
 * (agent → voice config cascades; knowledge domain → sources/runs/
 * chunks cascade) but KEEPS the DemoProspect row as status 'expired'
 * so the /try link degrades to a CTA page instead of a 404 and the
 * engagement history survives for the prospecting tool.
 * Claimed prospects have expiresAt null — never touched.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordCronRun } from '@/lib/cron-heartbeat'

const MAX_PER_RUN = 50
const REGISTERED_MAX_AGE_DAYS = 90

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  let reaped = 0
  let failedRows = 0

  try {
    const expired = await db.demoProspect.findMany({
      where: {
        status: { in: ['ready', 'failed', 'provisioning'] },
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, slug: true, agentId: true, knowledgeDomainId: true },
      take: MAX_PER_RUN,
    })

    for (const p of expired) {
      try {
        if (p.agentId) await db.agent.delete({ where: { id: p.agentId } }).catch(() => {})
        if (p.knowledgeDomainId) await db.knowledgeDomain.delete({ where: { id: p.knowledgeDomainId } }).catch(() => {})
        await db.demoProspect.update({
          where: { id: p.id },
          data: { status: 'expired', agentId: null, knowledgeDomainId: null, ingestionRunId: null },
        })
        reaped++
      } catch (err) {
        failedRows++
        console.error(`[demo-reaper] failed for ${p.slug}:`, err)
      }
    }

    // Never-clicked rows from ancient campaigns: expire quietly.
    const stale = await db.demoProspect.updateMany({
      where: {
        status: 'registered',
        createdAt: { lt: new Date(now.getTime() - REGISTERED_MAX_AGE_DAYS * 86400_000) },
      },
      data: { status: 'expired' },
    })

    await recordCronRun('demo-prospect-reaper', true)
    return NextResponse.json({ reaped, failedRows, staleRegistered: stale.count })
  } catch (err) {
    await recordCronRun('demo-prospect-reaper', false, err instanceof Error ? err.message : String(err))
    console.error('[demo-reaper] run failed:', err)
    return NextResponse.json({ error: 'reaper failed' }, { status: 500 })
  }
}
