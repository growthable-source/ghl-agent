/**
 * SMS Message Debounce
 *
 * In SMS, people often send multiple short messages in quick succession that
 * form a single thought. This module accumulates rapid messages per contact
 * and triggers the agent once with all of them combined.
 *
 * Strategy (serverless-safe):
 * 1. Each inbound message is written to a buffer table with a timestamp
 * 2. The webhook waits DEBOUNCE_MS before processing
 * 3. After waiting, it reads ALL buffered messages for that contact
 * 4. If this request's message is the LATEST one, it processes all of them
 * 5. If a newer message arrived while we waited, this request exits (the newer one will handle it)
 */

import { db } from './db'

const DEBOUNCE_MS = 3000 // 3 seconds — enough for rapid texters

export interface BufferedMessage {
  id: string
  body: string
  createdAt: Date
}

/**
 * Buffer an inbound message and wait for the debounce window.
 * Returns the combined message text if this request should process,
 * or null if a later request will handle it.
 */
export async function debounceMessage(
  locationId: string,
  contactId: string,
  conversationId: string,
  body: string
): Promise<{ combinedMessage: string; messageIds: string[] } | null> {
  // 1. Write this message to the buffer
  const buffered = await db.messageBuffer.create({
    data: { locationId, contactId, conversationId, body },
  })

  // 2. Wait for the debounce window
  await new Promise(resolve => setTimeout(resolve, DEBOUNCE_MS))

  // 3. Read all unprocessed messages for this contact, ordered by time
  const pending = await db.messageBuffer.findMany({
    where: { locationId, contactId, processed: false },
    orderBy: { createdAt: 'asc' },
  })

  if (pending.length === 0) return null

  // 4. Check if our message is the latest one — only the latest request processes
  const latest = pending[pending.length - 1]
  if (latest.id !== buffered.id) {
    // A newer message arrived — that request will handle the batch
    return null
  }

  // 5. We're the latest — mark all as processed and combine
  const ids = pending.map(m => m.id)
  await db.messageBuffer.updateMany({
    where: { id: { in: ids } },
    data: { processed: true },
  })

  // Combine messages into one string
  const combinedMessage = pending.length === 1
    ? pending[0].body
    : pending.map(m => m.body).join('\n')

  return { combinedMessage, messageIds: ids }
}

/**
 * Clean up old processed buffer entries (call periodically or via cron)
 */
export async function cleanupMessageBuffer(olderThanHours = 24) {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
  await db.messageBuffer.deleteMany({
    where: { createdAt: { lt: cutoff }, processed: true },
  })
}
