/**
 * Daily cleanup of expired prospect demos. Deletes the heavy assets
 * (agent → voice config cascades; knowledge domain → sources/runs/
 * chunks cascade) but KEEPS the DemoProspect row as status 'expired'
 * so the /try link degrades to a CTA page instead of a 404 and the
 * engagement history survives for the prospecting tool.
 * Claimed prospects have expiresAt null — never touched.
 *
 * TOCTOU guard: a prospect can be claimed (by a real signup) in the
 * window between snapshotting candidates and deleting their assets —
 * claim.ts's CAS flips status to 'claimed' and nulls expiresAt the
 * instant it wins, but a reaper iteration already holding the old
 * snapshot wouldn't see that without re-checking. So each row is
 * claimed here too: an updateMany CAS conditioned on the same
 * (status in [...], expiresAt < now) predicate we selected on. If a
 * customer claim won the race, the CAS matches zero rows (status is
 * now 'claimed' and expiresAt is null — either alone breaks the
 * match) and the reaper skips the row entirely, leaving the
 * re-parented agent/domain untouched. Only after winning the CAS do
 * we delete the snapshotted assets, scoped to the demos workspace as
 * a second belt-and-braces guard against ever touching a re-parented
 * asset that raced past the CAS somehow.
 *
 * Embedded-checkout purchase guard (lib/demo-purchase/state.ts): a paid
 * buyer must NEVER be reaped, full stop. Two layers already keep a live
 * purchase out of the `expiresAt < now` candidate set before it ever
 * reaches this file — the checkout-session route extends expiresAt +14d
 * the moment checkout starts, and fulfillDemoBundle() nulls expiresAt
 * entirely the instant Stripe confirms payment (before claimProspect()
 * even runs, which is what actually flips DemoProspect.status to
 * 'claimed' and drops the row out of CLAIMABLE_STATUSES for good). This
 * is the third, belt-and-braces layer: skip any candidate whose
 * `metadata.purchase.state` shows they've actually paid, regardless of
 * what expiresAt says — an abandoned `checkout_started` (never paid) is
 * still fair game once its extended window lapses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordCronRun } from '@/lib/cron-heartbeat'
import { demoWorkspaceId } from '@/lib/demo-prospects/provision'
import { getPurchase } from '@/lib/demo-purchase/state'

const MAX_PER_RUN = 50
const REGISTERED_MAX_AGE_DAYS = 90
const CALL_RETENTION_DAYS = 30
const CLAIMABLE_STATUSES = ['ready', 'failed', 'provisioning']

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const workspaceId = demoWorkspaceId()
  if (!workspaceId) {
    console.warn('[demo-reaper] DEMO_WORKSPACE_ID unset — skipping run')
    await recordCronRun('demo-prospect-reaper', false, 'DEMO_WORKSPACE_ID unset')
    return NextResponse.json({ error: 'DEMO_WORKSPACE_ID unset' }, { status: 200 })
  }

  const now = new Date()
  let reaped = 0
  let skippedRaced = 0
  let skippedLivePurchase = 0
  let failedRows = 0

  try {
    const expired = await db.demoProspect.findMany({
      where: {
        status: { in: CLAIMABLE_STATUSES },
        expiresAt: { not: null, lt: now },
      },
      select: { id: true, slug: true, agentId: true, knowledgeDomainId: true, metadata: true },
      take: MAX_PER_RUN,
    })

    for (const p of expired) {
      try {
        // Layer 3 guard — see the module doc comment. A purchase past
        // `checkout_started` means the buyer paid; never reap it here
        // even if expiresAt somehow wasn't cleared yet.
        const purchase = getPurchase(p.metadata)
        if (purchase && purchase.state !== 'checkout_started') {
          skippedLivePurchase++
          continue
        }
        // CAS BEFORE deleting anything: only proceed if this row still
        // matches the same predicate we selected on. A claim that raced
        // in between flips status to 'claimed' + expiresAt to null, so
        // this matches zero rows and we must not touch its assets.
        const won = await db.demoProspect.updateMany({
          where: {
            id: p.id,
            status: { in: CLAIMABLE_STATUSES },
            expiresAt: { not: null, lt: now },
          },
          data: { status: 'expired' },
        })
        if (won.count === 0) {
          skippedRaced++
          continue
        }

        // Won the claim — safe to delete the snapshotted assets. Scope
        // deletes to the demos workspace so a re-parented agent/domain
        // (which would no longer live here) can never match even if
        // this snapshot were somehow stale.
        if (p.agentId) {
          await db.agent.deleteMany({ where: { id: p.agentId, workspaceId } }).catch(() => {})
        }
        if (p.knowledgeDomainId) {
          await db.knowledgeDomain.deleteMany({ where: { id: p.knowledgeDomainId, workspaceId } }).catch(() => {})
        }
        await db.demoProspect.update({
          where: { id: p.id },
          data: { agentId: null, knowledgeDomainId: null, ingestionRunId: null },
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

    // DemoTryCall retention: these are only ever used for the short-lived
    // per-IP/concurrency abuse guards — nothing reads them past that
    // window, so old rows are pure bloat.
    const calls = await db.demoTryCall.deleteMany({
      where: { startedAt: { lt: new Date(now.getTime() - CALL_RETENTION_DAYS * 86400_000) } },
    })

    await recordCronRun('demo-prospect-reaper', true)
    return NextResponse.json({
      reaped,
      skippedRaced,
      skippedLivePurchase,
      failedRows,
      staleRegistered: stale.count,
      callsDeleted: calls.count,
    })
  } catch (err) {
    await recordCronRun('demo-prospect-reaper', false, err instanceof Error ? err.message : String(err))
    console.error('[demo-reaper] run failed:', err)
    return NextResponse.json({ error: 'reaper failed' }, { status: 500 })
  }
}
