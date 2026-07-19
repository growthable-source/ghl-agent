/**
 * Inbound message debounce + idempotency.
 *
 * Two jobs:
 *
 * 1. Idempotency. GHL re-delivers the same webhook whenever our handler is
 *    slow to ack (and the agent loop is always slow). The first writer of
 *    a `messageId` row wins — duplicates hit the unique constraint and we
 *    drop them immediately. This is the only correct way to dedupe; every
 *    timing-window guard we tried before this had a hole in it.
 *
 * 2. Debounce. SMS users send several short messages back-to-back that form
 *    one thought. We buffer for DEBOUNCE_MS, then the latest message in the
 *    window picks up the whole batch and runs the agent once.
 */
import { db } from './db'

const DEBOUNCE_MS = 3000

export async function debounceMessage(
  locationId: string,
  contactId: string,
  conversationId: string,
  body: string,
  messageId: string | null,
  /**
   * Coalescing window in ms. Defaults to DEBOUNCE_MS (3s). The webhook
   * widens this to the largest per-agent "wait time before responding"
   * configured on the location, so operators can batch rapid inbound
   * messages into a single reply. Clamped by the caller.
   */
  waitMs: number = DEBOUNCE_MS,
): Promise<{ combinedMessage: string; messageIds: string[] } | null> {
  // 1. Insert. If `messageId` is already in the table, this is a GHL retry
  //    of a webhook we've already received — drop it. P2002 is Prisma's
  //    unique-constraint-violation code. (Postgres allows multiple NULLs
  //    in a unique index, so messageId=null bypasses idempotency for
  //    channels that don't supply one — we still get debounce semantics.)
  let buffered: { id: string }
  try {
    buffered = await db.messageBuffer.create({
      data: { locationId, contactId, conversationId, body, messageId },
      select: { id: true },
    })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      console.log(`[Debounce] Duplicate webhook for messageId=${messageId} — dropping`)
      return null
    }
    throw err
  }

  // 2. Wait for the debounce window so chatty users get coalesced.
  await new Promise(resolve => setTimeout(resolve, Math.max(0, waitMs)))

  // 3. Read all unprocessed buffered messages for this contact.
  const pending = await db.messageBuffer.findMany({
    where: { locationId, contactId, processed: false },
    orderBy: { createdAt: 'asc' },
  })
  if (pending.length === 0) return null

  // 4. Only the latest writer in the window processes the batch. Older
  //    waiters return null — the latest one will pick up their messages too.
  if (pending[pending.length - 1].id !== buffered.id) return null

  // 5. Mark the batch processed and return the combined text.
  const ids = pending.map(m => m.id)
  await db.messageBuffer.updateMany({
    where: { id: { in: ids } },
    data: { processed: true },
  })

  const combinedMessage = pending.length === 1
    ? pending[0].body
    : pending.map(m => m.body).join('\n')

  return { combinedMessage, messageIds: ids }
}

export async function cleanupMessageBuffer(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
  await db.messageBuffer.deleteMany({
    where: { createdAt: { lt: cutoff }, processed: true },
  })
}
