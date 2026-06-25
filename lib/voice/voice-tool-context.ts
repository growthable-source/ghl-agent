/**
 * Shared voice tool-call resolver.
 *
 * Voice runtimes (Vapi webhook, and the legacy Gemini path) dispatch CRM /
 * calendar tools through the SAME canonical executeTool the text agent uses
 * — no parallel tool stack. This helper is the thin voice-specific glue:
 * per call it (1) resolves the caller's existing contact from their phone
 * so "the caller" is the default contact, (2) injects the agent's bound
 * calendarId for calendar tools (the model doesn't know it), (3) normalizes
 * the availability window, then hands off to executeTool with channel='voice'.
 *
 * The unknown-caller booking fix lives here in one place: a brand-new caller
 * has no contact, so the agent captures them via upsert_contact and books
 * against the returned id; a known caller is resolved here and book_appointment
 * falls back to that context contactId (see execute-tool.ts) even when the
 * model omits it.
 */

import { executeTool } from '@/lib/agent/execute-tool'
import { searchContacts } from '@/lib/crm-client'

/** Tools that need the agent's bound calendarId injected when the model omits it. */
const CALENDAR_TOOLS = new Set([
  'get_available_slots',
  'book_appointment',
  'cancel_appointment',
  'reschedule_appointment',
  'get_calendar_events',
])

export interface VoiceToolCall {
  name: string
  params: Record<string, unknown>
  agentId: string
  locationId: string
  workspaceId: string | null
  /** Caller's phone (E.164). Resolves the default contact. Empty for unknown/blocked callers. */
  callerPhone: string
  /** The agent's bound calendar (Agent.calendarId), or null. */
  calendarId: string | null
}

/**
 * Resolve the caller's existing contact id from their phone number.
 * Best-effort — returns undefined for unknown callers (the agentic flow
 * then captures them via upsert_contact, and book_appointment uses that
 * result's contactId on the next turn).
 */
async function resolveCallerContactId(locationId: string, callerPhone: string): Promise<string | undefined> {
  if (!callerPhone) return undefined
  try {
    const matches = await searchContacts(locationId, callerPhone)
    const exact = (matches as any[])?.find?.((c: any) => c.phone === callerPhone) ?? (matches as any[])?.[0]
    return exact?.id
  } catch {
    return undefined
  }
}

/**
 * Derive a [startDate, endDate] window for get_available_slots when the
 * voice model passes only a single `date` (or nothing). The catalogue tool
 * needs startDate+endDate; default to a 7-day look-ahead.
 */
function normalizeSlotWindow(params: Record<string, unknown>): { startDate: string; endDate: string } {
  const start = (typeof params.startDate === 'string' && params.startDate)
    || (typeof params.date === 'string' && params.date)
    || new Date().toISOString().split('T')[0]
  let end = (typeof params.endDate === 'string' && params.endDate) || ''
  if (!end) {
    const d = new Date(start as string)
    if (!isNaN(d.getTime())) { d.setDate(d.getDate() + 7); end = d.toISOString().split('T')[0] }
    else { end = start as string }
  }
  return { startDate: start as string, endDate: end }
}

/**
 * Dispatch one voice tool call through the canonical executeTool with the
 * caller's resolved contact as the default contact and the agent's calendar
 * injected for calendar tools. Returns executeTool's string result verbatim.
 */
export async function runVoiceAgentTool(call: VoiceToolCall): Promise<string> {
  const { name, agentId, locationId, workspaceId, callerPhone, calendarId } = call
  const input: Record<string, unknown> = { ...call.params }

  if (CALENDAR_TOOLS.has(name) && calendarId && !input.calendarId) {
    input.calendarId = calendarId
  }
  if (name === 'get_available_slots') {
    const { startDate, endDate } = normalizeSlotWindow(input)
    input.startDate = startDate
    input.endDate = endDate
  }

  const contextContactId = await resolveCallerContactId(locationId, callerPhone)

  // Positional contract — see executeTool signature. channel='voice',
  // workspaceId = param 12, contactId context = param 13. agentId IS passed
  // so failure reporting + per-tool config resolve, but NO conversationId /
  // messageHistory (voice has none) — the enforced gate is governed by the
  // voice preset's autonomous mode.
  return executeTool(
    name,
    input,
    locationId,
    false,            // sandbox
    agentId,
    'voice',          // channel
    undefined,        // conversationProviderId
    undefined,        // adapter (resolved from locationId inside executeTool)
    undefined,        // deferredSend
    undefined,        // fieldOverwriteMap
    undefined,        // handoverCapture
    workspaceId,      // param 12
    contextContactId, // param 13 — the caller as default contact
  )
}
