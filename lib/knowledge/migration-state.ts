import { db } from '@/lib/db'

/**
 * Has the collections-unification SQL run yet?
 *
 * `KnowledgeSource.collectionId` arrives via hand-run SQL
 * (prisma/sql/2026-07-22-unify-knowledge-collections.sql), so a deploy
 * can land before the column does. Every query that groups sources by
 * collection references it, and Prisma raises P2022 on a missing column
 * — which would 500 the Knowledge page and blind the agent runtime.
 *
 * So: probe once per process, cache, and let callers pick a query shape.
 * A fresh lambda re-probes, so the flip happens on its own once the SQL
 * runs — no redeploy needed.
 */

let cached: boolean | null = null

export async function sourceCollectionsReady(): Promise<boolean> {
  if (cached !== null) return cached
  try {
    const rows = await db.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'KnowledgeSource' AND column_name = 'collectionId'
      ) as exists
    `
    cached = !!rows[0]?.exists
  } catch {
    cached = false
  }
  return cached
}

/** True when a Prisma error is "that column doesn't exist yet". */
export function isMissingColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null
  return e?.code === 'P2021'
    || e?.code === 'P2022'
    || /column .* does not exist|relation .* does not exist/i.test(e?.message ?? '')
}

/** Test seam / manual reset after running the SQL in a long-lived process. */
export function resetSourceCollectionsProbe(): void {
  cached = null
}
