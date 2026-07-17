/**
 * POST /api/public/try/[slug]/train — the explicit "Train my AI
 * receptionist" action. This is the ONLY thing that triggers
 * provisioning + crawling now; the status route (GET .../status) is
 * read-only. See app/try/[slug]/TryDemoClient.tsx for the client flow.
 *
 * Body: { websiteUrl?: string }
 *
 * Rate limiting: v1 deliberately skips a per-IP limiter here. The slug
 * itself is unguessable (8 hex chars of randomness, see
 * lib/demo-prospects/slug.ts) and doubles as the possession check, and
 * the per-source retrain cap below (MAX_RUNS_PER_SOURCE) bounds the
 * total crawl cost per prospect regardless of how many times the train
 * button is mashed. If this route needs a real per-IP limiter later,
 * DemoTryCall is NOT the right table (that's call minutes, not train
 * clicks) — add a dedicated counter.
 */
import { NextRequest, NextResponse } from 'next/server'
import { after } from 'next/server'
import { db } from '@/lib/db'
import { ensureProvisioned, demoWorkspaceId } from '@/lib/demo-prospects/provision'
import { validatePublicUrl, InvalidUrlError } from '@/lib/demo-prospects/validate-url'
import { detectUrl } from '@/lib/ingest/detect'
import { ingestSource } from '@/lib/ingest/pipeline'

export const maxDuration = 300

const MAX_RUNS_PER_SOURCE = 3
// Same soft per-invocation budget the ingest-queue cron uses, leaving
// headroom under the 300s maxDuration for bookkeeping.
const DEADLINE_BUDGET_MS = 240_000

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  if (!demoWorkspaceId()) {
    return NextResponse.json({ error: 'not_configured' }, { status: 503 })
  }

  let prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (prospect.status === 'expired' || prospect.status === 'claimed') {
    return NextResponse.json({ error: 'gone', status: prospect.status }, { status: 410 })
  }

  const body = await req.json().catch(() => ({}))
  const rawUrl = typeof body?.websiteUrl === 'string' ? body.websiteUrl.trim() : ''

  let urlChangeIgnored = false
  if (rawUrl) {
    let validated: { normalizedUrl: string; domain: string }
    try {
      validated = validatePublicUrl(rawUrl)
    } catch (err) {
      const message = err instanceof InvalidUrlError ? err.message : 'Invalid websiteUrl'
      return NextResponse.json({ error: 'invalid_url', message }, { status: 400 })
    }
    if (validated.domain !== prospect.websiteDomain) {
      // Retry-with-a-different-site is allowed when there's nothing to
      // lose: not yet provisioned, OR provisioned but the latest run
      // ended with zero chunks (bot-walled site, wrong URL, delivery
      // platform page). A demo that already HAS knowledge keeps its
      // domain — swapping it out from under a working agent is not v1.
      let retryEligible = prospect.status === 'registered'
      if (!retryEligible && prospect.status === 'ready' && prospect.ingestionRunId) {
        const run = await db.ingestionRun.findUnique({
          where: { id: prospect.ingestionRunId },
          select: { status: true, chunksCreated: true },
        })
        retryEligible = !!run && ['success', 'partial', 'failed'].includes(run.status) && run.chunksCreated === 0
      }
      if (retryEligible) {
        try {
          prospect = await db.demoProspect.update({
            where: { id: prospect.id },
            data: { websiteUrl: validated.normalizedUrl, websiteDomain: validated.domain },
          })
        } catch (err) {
          // Partial unique index: another LIVE demo already owns the new
          // domain. Friendly refusal beats a 500.
          if ((err as { code?: string })?.code === 'P2002') {
            return NextResponse.json(
              { error: 'domain_taken', message: 'That website already has a live demo — use its original link, or try a different site.' },
              { status: 409 },
            )
          }
          throw err
        }
        // Point the existing crawl source at the new site so the
        // retrain below fetches the right thing.
        if (prospect.knowledgeDomainId) {
          const detection = await detectUrl(prospect.websiteUrl)
          await db.knowledgeSource.updateMany({
            where: { knowledgeDomainId: prospect.knowledgeDomainId },
            data: {
              urlOrIdentifier: prospect.websiteUrl,
              sourceType: detection.sourceType,
              crawlConfig: detection.crawlConfig as object,
            },
          })
        }
      } else {
        urlChangeIgnored = true
      }
    }
  }

  // Retrain path: prospect already went through provisioning and its
  // latest run finished with nothing to show for it. Re-queue a fresh
  // run on the SAME source (capped) rather than re-provisioning from
  // scratch. Anything else (still building, or already has chunks) is
  // a no-op success — double-clicking "train" must be idempotent.
  if (prospect.status === 'ready' && prospect.ingestionRunId) {
    const latestRun = await db.ingestionRun.findUnique({ where: { id: prospect.ingestionRunId } })
    const isTerminal = latestRun && ['success', 'partial', 'failed'].includes(latestRun.status)
    if (latestRun && isTerminal && latestRun.chunksCreated === 0) {
      // Infra-failed runs don't count toward the cap — a platform hiccup
      // (missing migration, transient DB error) must not consume the
      // visitor's limited training attempts. Completed-but-empty runs
      // ('success'/'partial' with 0 chunks) DO count, so a genuinely
      // unreadable site can't be re-crawled forever.
      const totalRuns = await db.ingestionRun.count({
        where: { sourceId: latestRun.sourceId, status: { not: 'failed' } },
      })
      if (totalRuns < MAX_RUNS_PER_SOURCE) {
        const newRun = await db.ingestionRun.create({
          data: { sourceId: latestRun.sourceId, status: 'queued' },
          select: { id: true },
        })
        await db.demoProspect.update({
          where: { id: prospect.id },
          data: { ingestionRunId: newRun.id },
        })
        const sourceId = latestRun.sourceId
        const runId = newRun.id
        after(() => claimAndIngest(runId, sourceId))
      }
      // Cap hit (or otherwise): no-op success, nothing new to report.
    }
    return NextResponse.json({ status: 'ready', urlChangeIgnored })
  }

  const ensured = await ensureProvisioned(slug)
  if (!ensured) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Fast-start the crawl in this same invocation instead of waiting for
  // the every-minute cron to notice the queued run. If ensureProvisioned
  // didn't (yet) attach a run — raced with another provisioning attempt,
  // or the best-effort knowledge step failed — there's nothing to claim
  // here; the cron (and later polls of /status re-entering ensureProvisioned
  // territory would, but we don't call that from here anymore) remains
  // the backstop for filling it in.
  if (ensured.ingestionRunId) {
    const run = await db.ingestionRun.findUnique({
      where: { id: ensured.ingestionRunId },
      select: { sourceId: true, status: true },
    })
    if (run && run.status === 'queued') {
      const runId = ensured.ingestionRunId
      const sourceId = run.sourceId
      after(() => claimAndIngest(runId, sourceId))
    }
  }

  return NextResponse.json({ status: ensured.status, urlChangeIgnored })
}

/**
 * Claim + run a queued IngestionRun inline, right after the response
 * has gone out. Reuses the EXACT compare-and-swap claim the ingest-queue
 * cron uses (app/api/cron/ingest-queue/route.ts) — an updateMany scoped
 * to status='queued' — so the cron and this fast-start path can never
 * both process the same run: whichever gets there first flips the
 * status and the other's updateMany matches zero rows and bails.
 *
 * If after() doesn't fire, or the claim loses the race, or ingestSource
 * throws: the run simply stays in whatever state it's in and the
 * every-minute cron picks it up as normal. That's the backstop — log
 * and move on, no special handling needed here.
 */
async function claimAndIngest(runId: string, sourceId: string): Promise<void> {
  try {
    const claimed = await db.ingestionRun.updateMany({
      where: { id: runId, status: 'queued' },
      data: { status: 'running', startedAt: new Date() },
    })
    if (claimed.count === 0) return // cron (or a concurrent train click) already has it

    const tickStart = Date.now()
    const result = await ingestSource(sourceId, { runId, deadlineAt: tickStart + DEADLINE_BUDGET_MS })
    if (result.deadlineExhausted) {
      await db.ingestionRun
        .create({ data: { sourceId, status: 'queued' } })
        .catch(() => undefined)
      console.log(`[demo-prospects] train fast-start queued continuation for source ${sourceId}`)
    }
  } catch (err) {
    console.error(`[demo-prospects] train fast-start ingest failed for run ${runId} (cron backstop will retry):`, err)
  }
}
