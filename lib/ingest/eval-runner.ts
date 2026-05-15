/**
 * Retrieval eval runner.
 *
 * Executes every query in a RetrievalEvalSet against the live
 * retrieval stack, snapshots the top-K chunks per query into
 * RetrievalEvalResult, computes labels-pending summary stats.
 *
 * Frozen snapshot — re-running an evaluation creates a NEW
 * RetrievalEvalRun. Historical results never mutate; weight-tuning
 * decisions trace back through the audit chain.
 */

import { db } from '@/lib/db'
import { retrieveChunks } from './retrieve'
import { EMBEDDING_MODEL } from './embed'

const RUBRIC_VERSION = '2026-05-15.v1'

export interface EvalRunOptions {
  /** Top-K to capture per query. Default 6 — matches production. */
  limit?: number
  /** Minimum similarity to include. Default 0.4 — matches production. */
  minSimilarity?: number
  /** Pre-created RetrievalEvalRun id. The async POST handler creates
   *  the row up front so the client has a stable polling target the
   *  moment the response returns; this lets us reuse it. */
  runId?: string
}

export interface EvalRunResult {
  runId: string
  evalSetId: string
  status: 'success' | 'failed'
  queriesProcessed: number
}

/**
 * Run an eval set end-to-end. Creates a Run row, executes retrieve
 * against each query, persists per-query Result rows with frozen
 * chunk snapshots, and marks the run complete. Returns the runId
 * so the UI can poll for label-pending stats.
 *
 * Soft fails per query — one query that errors doesn't kill the run.
 */
export async function runEval(
  evalSetId: string,
  opts: EvalRunOptions = {},
): Promise<EvalRunResult> {
  const limit = opts.limit ?? 6
  const minSimilarity = opts.minSimilarity ?? 0.4

  const evalSet = await (db as any).retrievalEvalSet.findUnique({
    where: { id: evalSetId },
    include: {
      queries: { orderBy: { createdAt: 'asc' } },
      workspace: { select: { id: true } },
    },
  })
  if (!evalSet) throw new Error(`RetrievalEvalSet ${evalSetId} not found`)

  const workspaceId: string = evalSet.workspaceId

  const configSnapshot = { limit, minSimilarity, embeddingModel: EMBEDDING_MODEL, retrievalVersion: 'phase2.v1' }

  // Use the caller-supplied run row if present; otherwise create one.
  // The async POST handler pre-creates so the client can poll
  // immediately.
  const run = opts.runId
    ? await (db as any).retrievalEvalRun.update({
        where: { id: opts.runId },
        data: {
          status: 'running',
          config: configSnapshot,
          rubricVersion: RUBRIC_VERSION,
        },
        select: { id: true },
      })
    : await (db as any).retrievalEvalRun.create({
        data: {
          evalSetId,
          status: 'running',
          config: configSnapshot,
          rubricVersion: RUBRIC_VERSION,
        },
        select: { id: true },
      })

  let processed = 0

  for (const q of evalSet.queries as Array<{ id: string; query: string }>) {
    try {
      const chunks = await retrieveChunks(workspaceId, q.query, { limit, minSimilarity })

      const snapshot = chunks.map((c, i) => ({
        rank: i,
        chunkId: c.id,
        // Truncate to 600 chars per chunk — enough context to label,
        // small enough to keep the JSON column manageable.
        content: c.content.slice(0, 600),
        sourceUrl: c.sourceUrl,
        primaryTopic: c.primaryTopic,
        similarity: Number(c.similarity.toFixed(4)),
      }))

      const result = await (db as any).retrievalEvalResult.create({
        data: {
          runId: run.id,
          queryId: q.id,
          retrievedChunks: snapshot,
          labels: {},
        },
        select: { id: true },
      })

      // Soft link to live chunks so we can chase the "what does this
      // chunk look like now" question without storing it twice.
      if (chunks.length > 0) {
        await (db as any).knowledgeChunkEvalRef.createMany({
          data: chunks.map((c, i) => ({
            resultId: result.id,
            chunkId: c.id,
            rank: i,
          })),
          skipDuplicates: true,
        }).catch(() => { /* non-fatal */ })
      }

      processed++
    } catch (err: any) {
      console.warn('[eval-runner] query failed:', q.id, err?.message)
      // Persist an empty result so the UI shows the query as "ran but no hits"
      try {
        await (db as any).retrievalEvalResult.create({
          data: {
            runId: run.id,
            queryId: q.id,
            retrievedChunks: [],
            labels: {},
          },
        })
      } catch { /* ignore */ }
    }
  }

  await (db as any).retrievalEvalRun.update({
    where: { id: run.id },
    data: {
      status: 'success',
      completedAt: new Date(),
      summary: await computeSummary(run.id),
    },
  })

  return {
    runId: run.id,
    evalSetId,
    status: 'success',
    queriesProcessed: processed,
  }
}

/**
 * Roll up labels into per-run summary stats. Called after every
 * label change to keep the dashboard in sync without a periodic
 * recompute job. Per the design pass:
 *
 *   net@K      = (helpful − harmful) / total_queries
 *   coverage@K = unique_helpful / total_queries  (proxy — we don't
 *                track required_helpful per query yet, so this is
 *                "% of queries with ≥1 helpful")
 *
 * Per-brand slice broken out so the operator can spot a brand whose
 * net@K drops below the workspace-wide score.
 */
export async function computeSummary(runId: string): Promise<Record<string, unknown>> {
  const results: Array<{
    netAtK: number | null
    coverageAtK: number | null
    query: { brandId: string | null }
  }> = await (db as any).retrievalEvalResult.findMany({
    where: { runId },
    select: {
      netAtK: true,
      coverageAtK: true,
      query: { select: { brandId: true } },
    },
  })

  const labelledResults = results.filter(r => r.netAtK !== null)
  const total = results.length
  const labelled = labelledResults.length

  // Workspace-wide averages.
  const avgNet = labelled > 0
    ? labelledResults.reduce((s, r) => s + (r.netAtK ?? 0), 0) / labelled
    : null
  const avgCoverage = labelled > 0
    ? labelledResults.reduce((s, r) => s + (r.coverageAtK ?? 0), 0) / labelled
    : null

  // Per-brand slice. brandId=null bucketed under '_workspace'.
  const perBrand: Record<string, { total: number; labelled: number; netAtK: number | null; coverageAtK: number | null }> = {}
  for (const r of results) {
    const key = r.query.brandId ?? '_workspace'
    if (!perBrand[key]) {
      perBrand[key] = { total: 0, labelled: 0, netAtK: 0, coverageAtK: 0 }
    }
    perBrand[key].total += 1
    if (r.netAtK !== null) {
      perBrand[key].labelled += 1
      perBrand[key].netAtK = (perBrand[key].netAtK ?? 0) + (r.netAtK ?? 0)
      perBrand[key].coverageAtK = (perBrand[key].coverageAtK ?? 0) + (r.coverageAtK ?? 0)
    }
  }
  for (const key of Object.keys(perBrand)) {
    const b = perBrand[key]
    b.netAtK = b.labelled > 0 ? Number((b.netAtK! / b.labelled).toFixed(3)) : null
    b.coverageAtK = b.labelled > 0 ? Number((b.coverageAtK! / b.labelled).toFixed(3)) : null
  }

  return {
    totalQueries: total,
    labelledQueries: labelled,
    netAtK: avgNet !== null ? Number(avgNet.toFixed(3)) : null,
    coverageAtK: avgCoverage !== null ? Number(avgCoverage.toFixed(3)) : null,
    perBrand,
  }
}

/**
 * Apply / clear a label on a single (result, chunk) and recompute
 * the result's netAtK + coverageAtK + the run's summary. Called
 * from the labeling UI on every click.
 *
 * label === null clears the label.
 */
export async function applyLabel(
  resultId: string,
  chunkId: string,
  label: 'helpful' | 'neutral' | 'harmful' | null,
  reason: string | null,
  labeledBy: string,
): Promise<void> {
  const result = await (db as any).retrievalEvalResult.findUnique({
    where: { id: resultId },
    include: { run: { select: { id: true } } },
  })
  if (!result) throw new Error(`RetrievalEvalResult ${resultId} not found`)

  const labels = (result.labels ?? {}) as Record<string, any>
  if (label === null) {
    delete labels[chunkId]
  } else {
    labels[chunkId] = {
      label,
      reason: reason ?? null,
      labeledBy,
      labeledAt: new Date().toISOString(),
    }
  }

  // Recompute per-result scores from the labels.
  const chunks = Array.isArray(result.retrievedChunks)
    ? result.retrievedChunks as Array<{ chunkId: string }>
    : []
  let helpful = 0, neutral = 0, harmful = 0
  for (const c of chunks) {
    const l = labels[c.chunkId]?.label
    if (l === 'helpful') helpful++
    else if (l === 'neutral') neutral++
    else if (l === 'harmful') harmful++
  }
  const totalLabelled = helpful + neutral + harmful
  // net@K = (helpful − harmful) divided by K (the retrieved set size)
  const netAtK = chunks.length > 0
    ? Number(((helpful - harmful) / chunks.length).toFixed(3))
    : 0
  // coverage@K — for v1, "did we surface ANY helpful chunk?" (0 or 1)
  const coverageAtK = helpful > 0 ? 1 : 0

  await (db as any).retrievalEvalResult.update({
    where: { id: resultId },
    data: {
      labels,
      netAtK: totalLabelled > 0 ? netAtK : null,
      coverageAtK: totalLabelled > 0 ? coverageAtK : null,
    },
  })

  // Roll up the run summary.
  const summary = await computeSummary(result.run.id)
  await (db as any).retrievalEvalRun.update({
    where: { id: result.run.id },
    data: { summary },
  })
}
