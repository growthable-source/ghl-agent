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
 * buildSystemPrompt. The string this helper returns becomes the `base`
 * passed in as runAgent's `systemPrompt` option.
 */

import { buildKnowledgeBlock } from '../rag'
import { buildObjectivesBlockForAgent } from '../agent-objectives'
import { retrieveChunks, buildRetrievedKnowledgeBlock } from '../ingest/retrieve'

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

/**
 * Build the base system prompt that gets passed into runAgent's
 * `systemPrompt` option. Pure — does not touch the database.
 */
export async function buildBasePrompt(
  agent: AgentForPrompt,
  opts: BuildBasePromptOptions,
): Promise<string> {
  const { channel, incomingMessage, visitorContactId, channelInfoBlock, includeObjectives } = opts

  let prompt = agent.systemPrompt

  // Objectives go right after the agent's prompt so the model treats
  // them as primary task framing. Only the widget runner enables this
  // today; the native runner relies on the dashboard for objective
  // tracking and intentionally keeps the SMS prompt lean.
  if (includeObjectives) {
    prompt += await buildObjectivesBlockForAgent(agent.id, incomingMessage)
  }

  if (agent.instructions) {
    prompt += `\n\n## Additional Instructions\n${agent.instructions}`
  }

  prompt += buildKnowledgeBlock((agent.knowledgeEntries ?? []) as any, incomingMessage)

  // Phase 2 retrieval — pgvector-backed chunk search over the
  // workspace's KnowledgeSources. Runs in parallel with the legacy
  // KnowledgeEntry path; both blocks coexist in the prompt. Skips
  // when workspaceId or incomingMessage are absent, or when the
  // workspace simply has no chunks indexed yet. ~500ms Voyage embed
  // call per agent turn; failures fall through to [].
  if (agent.workspaceId && incomingMessage && incomingMessage.trim().length >= 3) {
    try {
      const retrieved = await retrieveChunks(agent.workspaceId, incomingMessage, { limit: 6 })
      prompt += buildRetrievedKnowledgeBlock(retrieved)
    } catch (err: any) {
      console.warn('[buildBasePrompt] retrieval failed:', err?.message)
    }
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
    prompt += QUICK_REPLY_INSTRUCTIONS
  }

  // Channel-specific tail appended verbatim. The native runner uses
  // this for the Meta 24-hour-window framing; widget passes it
  // through as undefined and the block is a no-op.
  if (channelInfoBlock) {
    prompt += `\n\n${channelInfoBlock}`
  }

  return prompt
}
