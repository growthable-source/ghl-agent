/**
 * Topic telemetry — record which knowledge domains/topics a visitor
 * question matched, so the portal Overview can answer "what are people
 * asking about, and which knowledge are we answering them from?".
 *
 * Runs OFF the reply path (called fire-and-forget from the widget runner
 * after the agent has already answered) so it can never add latency to or
 * break a chat. Re-runs retrieval against the agent's knowledge scope —
 * the same pgvector search the prompt builder used — and persists the
 * matched domain(s) as ConversationTopic rows. A `(conversationId, topic)`
 * unique constraint dedupes repeated hits within one conversation, so the
 * portal's "Top topics" count reflects distinct conversations per topic,
 * not raw message volume.
 *
 * Forward-looking: only conversations that happen after this ships get
 * topic rows. Historical chats have no captured topics.
 */

import { db } from '@/lib/db'
import { retrieveChunks } from '@/lib/ingest/retrieve'

export interface CaptureTopicsParams {
  agent: { workspaceId: string }
  conversationId: string
  widgetId: string
  /** The visitor's incoming message for this turn. */
  message: string
}

export async function captureConversationTopics(params: CaptureTopicsParams): Promise<void> {
  try {
    const message = (params.message || '').trim()
    // Short / trivial messages ("hi", "ok") carry no topic signal and
    // would just embed to noise.
    if (message.length < 6) return

    // Topic capture is a workspace-wide telemetry sweep — deliberately
    // NOT scoped to the answering agent's collections, so the panel
    // reports what visitors ask about, not what one agent could answer.
    const chunks = await retrieveChunks(params.agent.workspaceId, message, {
      limit: 4,
      // A touch stricter than the runtime 0.25 floor — only record a topic
      // when the match is genuinely confident, so the panel isn't padded
      // with weak/coincidental hits.
      minSimilarity: 0.32,
    })
    if (chunks.length === 0) return

    // Topic label = the collection name — the human-meaningful "topic of
    // knowledge" an operator actually curated. Falls back to the domain
    // name (pre-backfill sources) then the chunk's own primaryTopic.
    // chunks arrive best-match-first, so Map insertion order is preserved.
    const byTopic = new Map<string, string | null>() // topic label -> domainId
    for (const c of chunks) {
      const topic = (c.collectionName || c.domainName || c.primaryTopic || '').trim().slice(0, 120)
      if (!topic) continue
      if (!byTopic.has(topic)) byTopic.set(topic, c.knowledgeDomainId)
    }
    // Cap at the 3 best distinct topics for this message so one wide-ranging
    // question doesn't blanket every collection.
    const top = Array.from(byTopic.entries()).slice(0, 3)
    if (top.length === 0) return

    await db.conversationTopic.createMany({
      data: top.map(([topic, domainId]) => ({
        conversationId: params.conversationId,
        widgetId: params.widgetId,
        workspaceId: params.agent.workspaceId,
        domainId: domainId ?? null,
        topic,
      })),
      skipDuplicates: true, // (conversationId, topic) unique → repeats are no-ops
    })
  } catch {
    // Telemetry only — swallow everything (missing table pre-migration,
    // embed failure, etc.). Never affects the conversation.
  }
}
