/**
 * POST /api/public/try/[slug]/train — the explicit "Train my AI
 * receptionist" action. This is the ONLY thing that triggers
 * provisioning + crawling now; the status route (GET .../status) is
 * read-only. See app/try/[slug]/TryDemoClient.tsx for the client flow.
 *
 * Body: { websiteUrl?: string, answerNow?: boolean }
 *
 * `answerNow: true` is the "Answer the call" primary CTA — it skips URL
 * validation entirely (no website required) and calls
 * ensureProvisioned(slug, { skipCrawl: true }): agent + voice config
 * get created, no knowledge asset does, and the prospect finalizes to
 * `ready` so the visitor can start talking immediately. It's a
 * short-circuit at the top of this handler — it never touches the URL
 * validation / retrain / fallthrough logic below.
 *
 * Domain changes: the page promises "paste a new URL any time", and the
 * handler honors that. Submitting a URL on a different domain re-points
 * the demo at the new site — including a demo that's already trained:
 * every live chunk in the demo's (per-prospect) knowledge domain is
 * superseded (reason 'demo domain change') so the agent never answers
 * from a blend of two businesses, the crawl source is re-pointed, and a
 * fresh ingestion run is queued. The ingest pipeline has no
 * vanished-page sweep across domains, so the supersede here is
 * load-bearing — without it the old site's knowledge stays live.
 * The only times a domain change is refused: mid-crawl (a queued or
 * running ingestion run — resubmit when it lands) and the per-source
 * run cap below (bounds total crawl spend per demo).
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
import { ensureProvisioned, demoWorkspaceId, demoCrawlConfig } from '@/lib/demo-prospects/provision'
import { validatePublicUrl, InvalidUrlError } from '@/lib/demo-prospects/validate-url'
import { detectUrl } from '@/lib/ingest/detect'
import { ingestSource } from '@/lib/ingest/pipeline'

export const maxDuration = 300

// Initial crawl + retries + domain swaps all draw from this one budget.
// 3 was enough when a trained demo could never change its site; now that
// domain swaps are first-class (each one costs a fresh crawl), 5 keeps
// honest re-pointing possible while still bounding spend per prospect.
const MAX_RUNS_PER_SOURCE = 5
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
  const answerNow = body?.answerNow === true

  // "Answer the call" — no website needed. Idempotent: ensureProvisioned
  // itself no-ops (past the knowledge/agent/finalize work) once the
  // prospect is already ready, so double-clicking this button is safe.
  if (answerNow) {
    const ensured = await ensureProvisioned(slug, { skipCrawl: true })
    if (!ensured) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (ensured.status === 'expired' || ensured.status === 'claimed') {
      return NextResponse.json({ error: 'gone', status: ensured.status }, { status: 410 })
    }
    return NextResponse.json({ status: ensured.status, answered: ensured.status === 'ready' })
  }

  let urlChangeIgnored = false
  let domainChanged = false
  if (rawUrl) {
    let validated: { normalizedUrl: string; domain: string }
    try {
      validated = validatePublicUrl(rawUrl)
    } catch (err) {
      const message = err instanceof InvalidUrlError ? err.message : 'Invalid websiteUrl'
      return NextResponse.json({ error: 'invalid_url', message }, { status: 400 })
    }
    if (validated.domain !== prospect.websiteDomain) {
      const latestRun = prospect.ingestionRunId
        ? await db.ingestionRun.findUnique({
            where: { id: prospect.ingestionRunId },
            select: { status: true, sourceId: true },
          })
        : null
      const runLive = !!latestRun && ['queued', 'running'].includes(latestRun.status)
      if (prospect.status === 'provisioning' || runLive) {
        // Mid-crawl: swapping the source URL under a running ingest is
        // racy (the run already loaded the old source row). The UI hides
        // the input during training, so this only guards races.
        urlChangeIgnored = true
      } else {
        if (latestRun) {
          // This swap will need a fresh run on the existing source —
          // enforce the cap BEFORE mutating anything, so a capped-out
          // demo isn't left pointed at a site it never crawled.
          const totalRuns = await db.ingestionRun.count({
            where: { sourceId: latestRun.sourceId, status: { not: 'failed' } },
          })
          if (totalRuns >= MAX_RUNS_PER_SOURCE) {
            return NextResponse.json(
              { error: 'train_limit', message: 'This demo has used all its training runs — get in touch and we’ll point it wherever you like.' },
              { status: 429 },
            )
          }
        }
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
        if (prospect.knowledgeDomainId) {
          // Point the existing crawl source at the new site so the
          // retrain below fetches the right thing…
          const detection = await detectUrl(prospect.websiteUrl)
          await db.knowledgeSource.updateMany({
            where: { knowledgeDomainId: prospect.knowledgeDomainId },
            data: {
              urlOrIdentifier: prospect.websiteUrl,
              sourceType: detection.sourceType,
              crawlConfig: demoCrawlConfig(detection.crawlConfig) as object,
            },
          })
          // …and retire the old site's knowledge. The pipeline never
          // sweeps pages that simply stop being discovered, so without
          // this the agent would answer from both businesses at once.
          // The knowledge domain is per-prospect (see provision.ts), so
          // this can't touch any other demo. No-op when nothing crawled.
          await db.knowledgeChunk.updateMany({
            where: { knowledgeDomainId: prospect.knowledgeDomainId, supersededAt: null },
            data: { supersededAt: new Date(), supersessionReason: 'demo domain change' },
          })
        }
        domainChanged = true
      }
    }
  }

  // Retrain path: prospect already went through provisioning and either
  // its latest run finished with nothing to show for it, or the domain
  // was just swapped (old knowledge superseded above). Re-queue a fresh
  // run on the SAME source (capped) rather than re-provisioning from
  // scratch. Anything else (still building, or already has chunks on the
  // same domain) is a no-op success — double-clicking "train" must be
  // idempotent.
  if (prospect.status === 'ready' && prospect.ingestionRunId) {
    const latestRun = await db.ingestionRun.findUnique({ where: { id: prospect.ingestionRunId } })
    const isTerminal = latestRun && ['success', 'partial', 'failed'].includes(latestRun.status)
    if (latestRun && isTerminal && (latestRun.chunksCreated === 0 || domainChanged)) {
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
