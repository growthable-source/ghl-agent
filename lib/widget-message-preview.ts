/**
 * Last-message previews for inbox lists.
 *
 * A Prisma `include: { messages: { take: 1 } }` on `findMany` does not
 * push that `take` into SQL. It emits
 *
 *   SELECT content, translationEn, … FROM "WidgetMessage"
 *   WHERE "conversationId" IN (…)
 *
 * with no LIMIT, then slices to one row per parent in process. On the
 * polled inbox that was ~2,300 message rows per call (full text +
 * English translations) — the statement behind the egress spike.
 *
 * DISTINCT ON returns exactly one row per conversation, and LEFT()
 * truncates the preview in the database so the body never leaves
 * Postgres. translationEn is not selected.
 */

import { db } from '@/lib/db'

export interface MessagePreview {
  conversationId: string
  role: string
  sentByUserId: string | null
  kind: string
  content: string
  createdAt: Date
}

const PREVIEW_CHARS = 120
const CHUNK = 200

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

async function queryChunks<T>(
  ids: string[],
  run: (batch: string[]) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK)
    if (batch.length === 0) continue
    out.push(...await run(batch))
  }
  return out
}

/** Newest message per conversation, preview columns only. */
export async function loadLastMessagePreviews(conversationIds: string[]): Promise<Map<string, MessagePreview>> {
  const map = new Map<string, MessagePreview>()
  const ids = [...new Set(conversationIds.filter(Boolean))]
  if (ids.length === 0) return map
  try {
    const rows = await queryChunks(ids, batch => db.$queryRaw<MessagePreview[]>`
      SELECT DISTINCT ON ("conversationId")
        "conversationId",
        "role",
        "sentByUserId",
        "kind",
        LEFT("content", ${PREVIEW_CHARS}) AS "content",
        "createdAt"
      FROM "WidgetMessage"
      WHERE "conversationId" = ANY(${batch}::text[])
      ORDER BY "conversationId", "createdAt" DESC, "id" DESC
    `)
    for (const row of rows) {
      map.set(row.conversationId, { ...row, createdAt: asDate(row.createdAt) })
    }
  } catch (err) {
    console.warn('[widget-message-preview] last-message lookup failed:', err instanceof Error ? err.message : err)
  }
  return map
}

export interface VisitorPreview {
  content: string
  kind: string
}

/**
 * First visitor message per conversation — the new-chat popup only
 * needs a short preview, not the thread. Same DISTINCT ON shape as
 * the inbox preview, ordered oldest-first and filtered to role.
 */
export async function loadFirstVisitorPreviews(conversationIds: string[]): Promise<Map<string, VisitorPreview>> {
  const map = new Map<string, VisitorPreview>()
  const ids = [...new Set(conversationIds.filter(Boolean))]
  if (ids.length === 0) return map
  try {
    const rows = await queryChunks(ids, batch => db.$queryRaw<Array<{ conversationId: string; content: string; kind: string }>>`
      SELECT DISTINCT ON ("conversationId")
        "conversationId",
        "kind",
        LEFT("content", ${PREVIEW_CHARS}) AS "content"
      FROM "WidgetMessage"
      WHERE "conversationId" = ANY(${batch}::text[])
        AND "role" = 'visitor'
      ORDER BY "conversationId", "createdAt" ASC, "id" ASC
    `)
    for (const row of rows) map.set(row.conversationId, { content: row.content ?? '', kind: row.kind })
  } catch (err) {
    console.warn('[widget-message-preview] visitor-preview lookup failed:', err instanceof Error ? err.message : err)
  }
  return map
}
