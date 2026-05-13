/**
 * Voice tool list builder.
 *
 * XAI realtime accepts a `tools` array in session.update, shape compatible
 * with OpenAI's Realtime API (which is itself modelled on OpenAI's
 * chat/completions function-calling format). Our agent tools live as
 * Anthropic.Tool[] in lib/agent/tool-catalog.ts — same JSON Schema for
 * arguments, slightly different envelope. This module:
 *
 *   1. Reuses our existing tool catalogue (single source of truth for
 *      argument shapes — we don't fork schemas per provider).
 *   2. Filters to tools that make sense on a voice call. Messaging
 *      tools (send_reply, send_sms, send_email) are excluded — voice
 *      IS the messaging layer for a call; the model speaking is the
 *      reply, not a tool. Workflow/CRM-write tools are also gated to
 *      a safer subset by default so an agent can't accidentally fire
 *      a workflow from a mid-sentence voice mishearing.
 *   3. Converts Anthropic shape → XAI/OpenAI shape.
 *
 * Returns the agent's `enabledTools` array filtered to the voice-safe
 * set. If the agent has no commerce/CRM tools enabled, the returned
 * array can be empty — that's fine, voice just operates without tools.
 */

import type Anthropic from '@anthropic-ai/sdk'
import { AGENT_TOOLS } from '@/lib/agent/tool-catalog'

/**
 * Tools that are SAFE and USEFUL during a live voice call. Read-only
 * lookups + a few targeted commerce actions. Notably excluded:
 *
 *   - send_reply, send_sms, send_email, send_sms_followup — voice IS
 *     the reply channel for a call; an SMS follow-up belongs in a
 *     separate post-call hook, not mid-call.
 *   - update_contact_field, upsert_contact, create_task, add_to_workflow,
 *     remove_from_workflow, cancel_scheduled_message — these are
 *     non-trivial state mutations that should be authored as Plays
 *     (deterministic rules) not invoked by voice mid-conversation.
 *   - update_contact_tags / remove_contact_tags — same reasoning.
 *   - book_appointment / get_available_slots — voice has the existing
 *     hardcoded VAPI_TOOLS surface for booking; we'll unify later but
 *     don't double-up here.
 *
 * Kept in:
 *   - All Shopify read tools + record_back_in_stock_interest (safe,
 *     no money moves).
 *   - create_shopify_checkout — sends customer a checkout URL; we
 *     gate to scale this confidently once we've watched it in the wild.
 *   - create_shopify_discount — same, with the hard cap already in
 *     the dispatcher (50% / $200).
 *   - get_contact_details, get_opportunities, list_pipelines,
 *     get_calendar_events, find_contact_by_email_or_phone — pure reads.
 */
const VOICE_SAFE_TOOL_NAMES = new Set([
  // Read-only context
  'get_contact_details',
  'find_contact_by_email_or_phone',
  'get_opportunities',
  'list_pipelines',
  'get_calendar_events',
  // Shopify reads
  'search_shopify_products',
  'check_shopify_inventory',
  'lookup_shopify_customer',
  'check_shopify_order_status',
  // Shopify writes (intentional, gated by adapter-side caps)
  'create_shopify_checkout',
  'create_shopify_discount',
  'record_back_in_stock_interest',
])

/**
 * XAI/OpenAI realtime tool envelope. Shape verified against OpenAI
 * Realtime API spec; XAI's realtime is OpenAI-compatible per their
 * docs around chat completions function-calling.
 */
export interface XaiRealtimeTool {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

export function buildVoiceTools(enabledTools: string[]): XaiRealtimeTool[] {
  const enabled = new Set(enabledTools)
  return AGENT_TOOLS
    .filter(t => enabled.has(t.name) && VOICE_SAFE_TOOL_NAMES.has(t.name))
    .map(toolToXaiFormat)
}

function toolToXaiFormat(t: Anthropic.Tool): XaiRealtimeTool {
  // Anthropic's input_schema and OpenAI/XAI's parameters use the same
  // JSON Schema dialect, so we can pass it through unmodified.
  return {
    type: 'function',
    name: t.name,
    description: t.description ?? '',
    parameters: t.input_schema as Record<string, unknown>,
  }
}
