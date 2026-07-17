/**
 * Builds the full system prompt for a CRM (marketplace/LeadConnector) inbound
 * reply: base prompt + objectives + instructions + knowledge + pgvector RAG +
 * calendar/booking/cancel/reschedule procedures + long-term memory + qualifying
 * questions + persona.
 *
 * Extracted verbatim from the inbound webhook (app/api/webhooks/events) so the
 * out-of-band retry path (lib/model-retry.ts) rebuilds the EXACT same prompt a
 * live reply would have used — a retried message must not silently lose the
 * booking flow, RAG context, or persona. The webhook and the retry cron are
 * the only two callers; keep them on this single builder so they never drift.
 *
 * The result is split for prompt caching: `prompt` holds only content that is
 * byte-identical across sequential inbound messages in the same conversation
 * (runAgent puts it ahead of the Anthropic cache breakpoint). Everything that
 * varies per message or per minute — objectives relevance, keyword knowledge,
 * pgvector RAG, offered-slot recency, memory-summary age, qualifying state —
 * goes in `volatileContext`, rendered AFTER the breakpoint so it never
 * invalidates the cached prefix.
 */

import { buildKnowledgeBlock } from './rag'
import { retrieveAndFormatForAgent } from './agent/retrieve-for-agent'
import { getMemorySummaryWithMeta, getLastOfferedSlots } from './conversation-memory'
import { getUnansweredQuestions, buildQualifyingPromptBlock } from './qualifying'
import { buildPersonaBlock } from './persona'
import { buildObjectivesBlockForAgent } from './agent-objectives'

export interface CrmInboundPromptContext {
  /** Stable per-contact identifier — injected into the calendar/booking block. */
  contactId: string
  /** The inbound text being answered — drives objective/knowledge/RAG selection. */
  inboundMessage: string
}

/**
 * `agent` is the Prisma Agent row with `knowledgeEntries` included (the same
 * object the webhook loads). Typed broadly because the webhook reaches through
 * several optional relations with `(agent as any)`.
 */
/** Split CRM inbound prompt: `prompt` is stable within a conversation
 *  (cacheable prefix), `volatileContext` varies per message / per minute and
 *  must render after the prompt-cache breakpoint. */
export interface CrmInboundPromptResult {
  prompt: string
  volatileContext: string
}

export async function buildCrmInboundPrompt(
  agent: any,
  { contactId, inboundMessage }: CrmInboundPromptContext,
): Promise<CrmInboundPromptResult> {
  let fullPrompt = agent.systemPrompt
  // Everything keyed to the incoming message or wall clock accumulates
  // here — different bytes per turn would invalidate the Anthropic prompt
  // cache if they sat in the prefix. runAgent renders this after the
  // cache breakpoint.
  let volatileContext = ''
  // Objectives are relevance-flagged against the inbound message, so they
  // ride in the volatile tail.
  volatileContext += await buildObjectivesBlockForAgent(agent.id, inboundMessage)
  if (agent.instructions) fullPrompt += `\n\n## Additional Instructions\n${agent.instructions}`
  volatileContext += buildKnowledgeBlock(agent.knowledgeEntries, inboundMessage)
  // Phase 2 retrieval — pgvector chunk search over ingested sources.
  // Webhook-driven replies were skipping this entirely; agents
  // could ingest 500 pages but answer GHL inbound messages from
  // memory alone.
  const { block: phase2Block } = await retrieveAndFormatForAgent(
    { id: agent.id, workspaceId: (agent as any).workspaceId, knowledgeDomainIds: (agent as any).knowledgeDomainIds },
    inboundMessage,
  )
  volatileContext += phase2Block

  // Inject calendar ID if booking tools are enabled and a calendar is configured
  if (agent.calendarId && agent.enabledTools.some((t: string) => ['get_available_slots', 'book_appointment'].includes(t))) {
    // Surface any slots we offered on a prior turn so a "yes" reply
    // locks to a concrete ISO instead of triggering a re-fetch that
    // returns different times. Cleared automatically when book_appointment
    // succeeds or when the model decides to re-fetch a new window.
    const lastOffered = await getLastOfferedSlots(agent.id, contactId)
    let offeredBlock = ''
    if (lastOffered && Array.isArray(lastOffered.slots) && lastOffered.slots.length > 0) {
      const ageMs = Date.now() - new Date(lastOffered.recordedAt).getTime()
      const ageMin = Math.round(ageMs / 60_000)
      // Truncate to first 8 ISO strings — anything longer pollutes the
      // prompt without helping the agent pick.
      const slotIsos = (lastOffered.slots as any[])
        .map(s => typeof s === 'string' ? s : (s?.startTime || s?.start || s?.slotStart))
        .filter(Boolean)
        .slice(0, 8)
      if (slotIsos.length > 0) {
        offeredBlock = `\n\n## Slots You Already Offered (recorded ${ageMin}m ago${lastOffered.timezone ? `, in ${lastOffered.timezone}` : ''})
${slotIsos.map((iso: string) => `- ${iso}`).join('\n')}

If the contact's latest message is a positive confirmation ("yes", "sure", "ok", "works", "11.45", "11:45", "that one", "👍", a time matching one of the slots above, etc.), use the matching ISO from THIS list when calling book_appointment. Do NOT call get_available_slots again before booking — the slots above are still valid.`
      }
    }

    fullPrompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: ${contactId}

BOOKING PROCEDURE — follow this exactly when the contact wants to schedule:
1. If the "Slots You Already Offered" block exists below, treat those slots as authoritative and SKIP step 2. Only call \`get_available_slots\` for a fresh booking discussion or when the contact rejects every offered slot.
2. Otherwise, call \`get_available_slots\` ONCE with the Calendar ID above and a date range starting from today.
3. Propose ONE specific slot in your reply (don't list 10 — be decisive). Example: "I can do Thursday at 2pm your time — does that work?"
4. CONFIRMATION RULE — when the contact's reply is a positive confirmation ("yes", "sure", "works", "perfect", "ok", "sounds good", "👍", a time string like "11.45" or "11:45", or a brief affirmative), you MUST call \`book_appointment\` IMMEDIATELY in the same turn using:
   - calendarId: ${agent.calendarId}
   - contactId: ${contactId}
   - startTime: the EXACT ISO string from your offered slots — copy from "Slots You Already Offered" if present, otherwise from the most recent get_available_slots tool result in this turn
   DO NOT call \`get_available_slots\` after a confirmation. Slot availability is stable for minutes; re-fetching causes you to propose a different time and confuse the contact.
5. After book_appointment returns success, confirm the booked time to the contact in plain language. Never say "I've booked" without calling the tool — the booking won't exist.
6. Optionally call \`create_appointment_note\` to log context from the conversation.

CANCELLATION PROCEDURE — when the contact asks to cancel/remove/drop a meeting:
1. Call \`get_calendar_events\` with contactId=${contactId} to find the appointmentId.
2. Call \`cancel_appointment\` with that appointmentId. DO NOT say "I've cancelled" without calling the tool — the meeting stays on the calendar and the contact will show up.
3. Confirm cancellation to the contact after the tool returns success.

RESCHEDULE PROCEDURE — when the contact asks to move a meeting:
1. Call \`get_calendar_events\` to find the existing appointmentId.
2. Call \`get_available_slots\` for the new window the contact wants.
3. Propose one specific slot; on confirmation call \`reschedule_appointment\` with the appointmentId + exact startTime from get_available_slots.
4. Confirm the NEW time to the contact. Never say "I've moved it" without calling reschedule_appointment.`
    // The offered-slots block carries a "recorded Xm ago" stamp that
    // changes every minute — it must not sit in the cacheable prefix.
    volatileContext += offeredBlock
  }

  // Memory context and qualifying questions
  const [memorySummary, unanswered] = await Promise.all([
    getMemorySummaryWithMeta(agent.id, contactId),
    getUnansweredQuestions(agent.id, contactId),
  ])

  if (memorySummary) {
    // Stamp the summary with how recently it was regenerated so the
    // agent doesn't treat months-old context as fresh. The runAgent
    // path computes its own gap block from messageHistory; this is
    // the parallel signal for the long-term ContactMemory summary.
    const ageMs = Date.now() - memorySummary.updatedAt.getTime()
    const day = 86_400_000
    const ageStr = ageMs < 60 * 60_000 ? 'just now'
      : ageMs < day ? `${Math.round(ageMs / 3_600_000)} hours ago`
      : ageMs < 14 * day ? `${Math.round(ageMs / day)} days ago`
      : ageMs < 60 * day ? `${Math.round(ageMs / (7 * day))} weeks ago`
      : `${Math.round(ageMs / (30 * day))} months ago`
    // Age stamp changes hourly and the summary regenerates mid-conversation
    // — volatile, keep it out of the cacheable prefix.
    volatileContext += `\n\n## Previous Conversation Context (captured ${ageStr})\n${memorySummary.summary}\n\nIf this summary is more than a few days old, treat it as background — the contact's situation may have changed.`
  }
  // Qualifying state advances as the contact answers — volatile.
  volatileContext += buildQualifyingPromptBlock(unanswered, (agent as any).qualifyingStyle ?? 'strict')
  fullPrompt += buildPersonaBlock({
    agentPersonaName: agent.agentPersonaName,
    responseLength: agent.responseLength,
    formalityLevel: agent.formalityLevel,
    useEmojis: agent.useEmojis,
    neverSayList: agent.neverSayList,
    simulateTypos: agent.simulateTypos,
    typingDelayEnabled: agent.typingDelayEnabled,
    typingDelayMinMs: agent.typingDelayMinMs,
    typingDelayMaxMs: agent.typingDelayMaxMs,
    languages: agent.languages,
  })

  return { prompt: fullPrompt, volatileContext }
}
