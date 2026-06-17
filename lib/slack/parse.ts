export type SlackReplyClass = {
  visibility: 'public' | 'internal'
  text: string
}

/**
 * Classify a Slack thread reply.
 *
 * A reply is visitor-facing ("public") by default. A leading `!` marks it
 * internal — it becomes a ConversationNote and is never delivered to the
 * visitor. We strip the marker and one optional following space so
 * "!grabbing it" and "! grabbing it" both yield "grabbing it".
 */
export function classifySlackReply(raw: string): SlackReplyClass {
  const trimmed = (raw ?? '').trim()
  if (trimmed.startsWith('!')) {
    return { visibility: 'internal', text: trimmed.slice(1).replace(/^ /, '') }
  }
  return { visibility: 'public', text: trimmed }
}
