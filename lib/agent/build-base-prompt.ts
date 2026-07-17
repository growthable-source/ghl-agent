/**
 * Channel-aware base-prompt assembly.
 *
 * The widget runner, the native-channel runner (SMS / Meta), and any
 * future caller all need the same recipe before handing the prompt to
 * runAgent: agent.systemPrompt → optional instructions → knowledge →
 * channel-specific tail. Before this helper existed each runner
 * open-coded its own variant and they drifted (widget injected the
 * quick-reply marker, channel-inbound injected the 24-hour-window
 * tail, voice has its own runner entirely).
 *
 * runAgent then layers the runtime context (qualifying / detection /
 * listening / memory / persona / platform-guidelines) on top via
 * buildSystemPrompt. The `prompt` this helper returns becomes the `base`
 * passed in as runAgent's `systemPrompt` option.
 *
 * The result is split for prompt caching: `prompt` holds only content
 * that is byte-identical across sequential inbound messages in the same
 * conversation, so runAgent can put it ahead of the Anthropic cache
 * breakpoint. Everything derived from the incoming message (objectives
 * relevance, keyword knowledge, pgvector RAG) goes in `volatileContext`,
 * which runAgent renders AFTER the breakpoint — a new message then
 * re-bills only that tail instead of rewriting the whole cached prefix.
 */

import { buildKnowledgeBlock } from '../rag'
import { buildObjectivesBlockForAgent } from '../agent-objectives'
import { retrieveAndFormatForAgent } from './retrieve-for-agent'

/**
 * Minimal shape required of the agent record. Anything broader is fine —
 * this is intentionally loose so callers don't have to thread Prisma
 * types here.
 */
export interface AgentForPrompt {
  id: string
  systemPrompt: string
  instructions?: string | null
  knowledgeEntries?: any[] | null
  calendarId?: string | null
  enabledTools?: string[] | null
  /** Required for Phase 2 retrieval (pgvector chunks). When absent
   *  the new block is skipped and the agent falls back to the legacy
   *  knowledgeEntries path only. */
  workspaceId?: string | null
  /** Per-agent knowledge scope. Empty array / undefined = retrieve
   *  from every domain in the workspace (legacy default). Populated
   *  = only those domain ids. */
  knowledgeDomainIds?: string[] | null
  /** false = read only knowledgeDomainIds (empty = none). true /
   *  undefined = read every domain in the workspace (default). */
  knowledgeScopeAll?: boolean | null
}

export type PromptChannel = 'widget' | 'native'

export interface BuildBasePromptOptions {
  channel: PromptChannel
  /** The visitor's / contact's most recent message — fed into knowledge retrieval. */
  incomingMessage: string
  /**
   * For the 'widget' channel only: the synthetic visitor identifier used
   * as contactId in the runtime ("visitor:<uuid>"). Used in the calendar
   * configuration block so the model has a concrete value to reference.
   */
  visitorContactId?: string
  /**
   * Channel-specific tail appended verbatim after the knowledge block.
   * For native channels this is typically the "[Caller phone: …]" or
   * Meta's 24-hour-window framing. Pass an empty string to skip.
   */
  channelInfoBlock?: string
  /**
   * Whether to include the runAgent `objectives` block. Only the widget
   * runner currently does — the native runner intentionally omits it
   * because objective progress is reported through the dashboard rather
   * than the SMS/Meta thread.
   */
  includeObjectives?: boolean
}

/**
 * Whether this agent has any of the booking tools enabled. Used to
 * decide whether to inject the calendar configuration block.
 */
function hasBookingTool(agent: AgentForPrompt): boolean {
  const tools = agent.enabledTools ?? []
  return tools.includes('get_available_slots') || tools.includes('book_appointment')
}

// The widget renders replies as markdown (see components/ChatMarkdown),
// so the model can use real structure — but a chat bubble is ~320px
// wide, so this steers toward compact shapes: bold lead-ins over big
// headings, short bullet runs over walls of text.
const WIDGET_FORMATTING_INSTRUCTIONS = `

## Formatting (web widget)
Your replies render as markdown in a small chat window. Make them easy to scan:
- Keep paragraphs to 1–3 short sentences, with a blank line between paragraphs.
- Use hyphen bullets for lists, steps, or options — each item on its OWN line, with a blank line before the list starts. Never run bullets together on one line.
- Use **bold** for short lead-ins and key terms. Don't use # headings — they render too large in a chat bubble.
- No tables, no horizontal rules, no nested lists.
- Lead with the answer, then supporting detail. For a long topic, give the short version and offer to go deeper.`

/**
 * The widget-only "quick replies" instructions. Tells the model how to
 * mark up choice chips so the renderer can surface them as buttons.
 * Lifted verbatim from widget-agent-runner.ts.
 */
const QUICK_REPLY_INSTRUCTIONS = `

## Quick replies (web widget only)
When you want to offer the visitor 2–4 quick choices to click, end your
message with: <quickReplies>Option A|Option B|Option C</quickReplies>
The system strips the marker and renders each pipe-separated value as a
button. Use sparingly — for clear branching ("Yes / Not yet", "Pricing /
Booking / Other"). Don't use it for free-text answers.`

/** Split base prompt: `prompt` is stable within a conversation (cacheable
 *  prefix), `volatileContext` is derived from the incoming message and must
 *  render after the prompt-cache breakpoint. */
export interface BasePromptResult {
  prompt: string
  volatileContext: string
}

/**
 * Build the base system prompt that gets passed into runAgent's
 * `systemPrompt` + `volatileContext` options. Pure — does not touch the
 * database beyond the knowledge retrieval helpers.
 */
export async function buildBasePrompt(
  agent: AgentForPrompt,
  opts: BuildBasePromptOptions,
): Promise<BasePromptResult> {
  const { channel, incomingMessage, visitorContactId, channelInfoBlock, includeObjectives } = opts

  let prompt = agent.systemPrompt
  // Everything keyed to the incoming message accumulates here — a
  // different message produces different bytes, so these blocks would
  // invalidate the Anthropic prompt cache on every turn if they sat in
  // the prefix. runAgent renders this after the cache breakpoint.
  let volatileContext = ''

  // Objectives are relevance-flagged against the incoming message, so
  // they live in the volatile tail. Only the widget runner enables this
  // today; the native runner relies on the dashboard for objective
  // tracking and intentionally keeps the SMS prompt lean.
  if (includeObjectives) {
    volatileContext += await buildObjectivesBlockForAgent(agent.id, incomingMessage)
  }

  if (agent.instructions) {
    prompt += `\n\n## Additional Instructions\n${agent.instructions}`
  }

  volatileContext += buildKnowledgeBlock((agent.knowledgeEntries ?? []) as any, incomingMessage)

  // Phase 2 retrieval — pgvector chunk search over the workspace's
  // KnowledgeSources. Helper is shared with the playground, Twilio
  // SMS, and webhook paths so every runtime gets the same block.
  if (agent.workspaceId) {
    const { block } = await retrieveAndFormatForAgent(
      { id: agent.id, workspaceId: agent.workspaceId, knowledgeDomainIds: agent.knowledgeDomainIds, knowledgeScopeAll: agent.knowledgeScopeAll },
      incomingMessage,
    )
    volatileContext += block
  }

  // Calendar configuration. Widget gets a slightly more detailed block
  // with the visitor's email-collection note because visitors often
  // book without ever providing an email; native channels already have
  // a phone or email on file.
  if (agent.calendarId && hasBookingTool(agent)) {
    if (channel === 'widget') {
      prompt += `\n\n## Calendar Configuration
Calendar ID for booking: ${agent.calendarId}
Contact ID for this conversation: ${visitorContactId ?? 'visitor:unknown'}

Note: This conversation is happening on a website chat widget. When booking, use the visitor's email (ask for it if not provided — it's required for the calendar invite).`
    }
    // Native runners don't currently inject a calendar block here —
    // the calendar id is available to the agent through tool inputs
    // and the system prompt's "Booking Appointments" section. Leaving
    // this branch as a no-op preserves existing native behavior.
  }

  if (channel === 'widget') {
    prompt += WIDGET_FORMATTING_INSTRUCTIONS
    prompt += QUICK_REPLY_INSTRUCTIONS
  }

  // Channel-specific tail appended verbatim. The native runner uses
  // this for the Meta 24-hour-window framing; widget passes it
  // through as undefined and the block is a no-op.
  if (channelInfoBlock) {
    prompt += `\n\n${channelInfoBlock}`
  }

  // Vocabulary rules LAST so they sit closest to generation and read as
  // the final word — they explicitly override the knowledge passages
  // above (whose verbatim wording is exactly what leaked banned brand
  // names into replies). Rules with replacements are ALSO hard-enforced
  // on the output by the runners; this block is the model-level half.
  {
    const { parseVocabularyRules, buildVocabularyBlock } = await import('./vocabulary')
    const rules = parseVocabularyRules((agent as any).vocabularyRules, (agent as any).neverSayList)
    prompt += buildVocabularyBlock(rules)
    // The knowledge passages now render AFTER the vocabulary rules (they
    // moved to the volatile tail for prompt caching), so re-assert the
    // override there — otherwise the passages' verbatim wording reads as
    // the final word and banned brand names leak back into replies.
    if (rules.length > 0 && volatileContext) {
      volatileContext += `\n\nThe Vocabulary rules in your instructions override any wording used in the knowledge passages above.`
    }
  }

  return { prompt, volatileContext }
}
