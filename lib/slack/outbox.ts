import { db } from '@/lib/db'
import { getDecryptedBotToken } from './connection'
import { postMessage } from './client'

const MAX_ATTEMPTS = 5

export async function enqueueSlackMessage(input: {
  workspaceId: string
  conversationId: string
  channelId: string
  threadTs: string | null
  kind: 'parent' | 'reply'
  text: string
}) {
  await db.slackOutbox.create({ data: { ...input, status: 'queued' } })
}

/**
 * Drain queued outbound Slack messages. Mirrors lib/native-outbox.ts:
 * each row is atomically claimed (queued → sending) before sending so
 * concurrent cron invocations never double-post. A successful `parent`
 * post writes the returned ts back as the conversation's thread root.
 */
export async function drainSlackOutbox(opts: { limit?: number } = {}) {
  const queued = await db.slackOutbox.findMany({
    where: { status: 'queued' },
    orderBy: { createdAt: 'asc' },
    take: opts.limit ?? 50,
  })

  for (const m of queued) {
    const claim = await db.slackOutbox.updateMany({
      where: { id: m.id, status: 'queued' },
      data: { status: 'sending', attempts: { increment: 1 } },
    })
    if (claim.count === 0) continue // another worker claimed it

    try {
      const token = await getDecryptedBotToken(m.workspaceId)
      if (!token) throw new Error('no slack connection for workspace')

      const { ts } = await postMessage(token, {
        channel: m.channelId,
        text: m.text,
        thread_ts: m.threadTs ?? undefined,
      })

      await db.slackOutbox.update({
        where: { id: m.id },
        data: { status: 'sent', slackTs: ts, lastError: null },
      })

      // A parent post defines the conversation's thread root.
      if (m.kind === 'parent') {
        await db.widgetConversation
          .update({
            where: { id: m.conversationId },
            data: { slackChannelId: m.channelId, slackThreadTs: ts },
          })
          .catch(() => {})
      }
    } catch (err: unknown) {
      const attempts = m.attempts + 1
      const permanent = attempts >= MAX_ATTEMPTS
      const message = err instanceof Error ? err.message : String(err)
      await db.slackOutbox.update({
        where: { id: m.id },
        data: { status: permanent ? 'failed' : 'queued', lastError: message.slice(0, 500) },
      })
    }
  }
}
