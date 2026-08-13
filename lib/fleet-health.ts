/**
 * Fleet health — "is the AI actually answering customers right now?"
 *
 * Written after a 32-hour total outage (2026-08-11 → 08-13) that nobody was
 * paged for. The chain was: a renamed credential took the cheap provider
 * offline on Aug 8, every call silently fell back to Claude, the Anthropic
 * balance drained, and on Aug 11 both providers were failing so every agent
 * reply died. Detection was a colleague posting screenshots in Slack.
 *
 * Two conditions, deliberately measured off data the app already writes so
 * this needs no new table and no hand-applied SQL:
 *
 *   OUTAGE   — visitors are getting the "agent failed" fallback and NO real
 *              AI reply has landed in the window. This is customer-visible
 *              and is the Aug 11 signature exactly.
 *
 *   DEGRADED — the configured default model is serving nothing while agent
 *              traffic flows, i.e. every call is being rescued by the Claude
 *              fallback. Not customer-visible, but it multiplies spend and
 *              removes the safety net, which is what turned a routine billing
 *              lapse into a full outage. This is the Aug 8 signature.
 *
 * Why not use LlmUsageDaily.fellBackCalls for DEGRADED: that counter also
 * increments for *legitimate* capability escalations (a visitor sends an
 * image, DeepSeek has no vision, Claude takes it by design). A 100% fallback
 * ratio therefore does not imply a broken provider. Asking instead "did the
 * default model serve a single call today?" is unambiguous.
 */

import { db } from '@/lib/db'
import { SILENT_AGENT_FALLBACKS } from '@/lib/widget-entitlements'
import { resolveKey } from '@/lib/llm/registry'
import { CLAUDE_FALLBACK_KEY } from '@/lib/llm/registry'

/**
 * How far back the customer-visible outage check looks.
 *
 * Sixty minutes, not fifteen, and the number is measured rather than guessed.
 * Replaying twelve days of real WidgetMessage history against candidate rules:
 * a 15-minute window needing 3 fallbacks fired in only 11% of the windows
 * inside the actual 32-hour outage, because failures arrive at just ~6-10 per
 * hour. It would have missed the very incident it was written for. At 60
 * minutes the same data gives 59% window coverage with one false positive in
 * twelve days.
 *
 * Coverage understates real sensitivity: the cron re-evaluates a ROLLING
 * window every 5 minutes, so detection lands within minutes of the second
 * failed reply, not at the end of some aligned bucket.
 */
export const WINDOW_MINUTES = 60

/**
 * Two, so a single unlucky conversation never pages anyone, while two
 * failures with zero successes in an hour always does.
 *
 * The one historical hour this flags outside the outage (2026-08-04 03:00 —
 * two fallbacks, no successful AI reply) is a real miniature incident, not
 * noise: every visitor who wrote in that hour was failed. Worth an email.
 */
const MIN_FALLBACKS_FOR_OUTAGE = 2

/**
 * Below this many agent calls today, "the default model served zero" is not
 * yet meaningful — it is normal a few minutes after UTC midnight, or on a
 * quiet weekend.
 */
const MIN_AGENT_CALLS_FOR_DEGRADED = 20

export type FleetHealthStatus = 'ok' | 'degraded' | 'outage'

export interface FleetHealth {
  status: FleetHealthStatus
  /** One-line human summary, used as the alert subject. */
  headline: string
  /** Fuller explanation including what to check. */
  detail: string
  windowMinutes: number
  aiReplies: number
  fallbacks: number
  defaultModelKey: string
  defaultModelCallsToday: number
  agentCallsToday: number
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Read-only. Never throws: a health check that can fail the request it runs
 * in is worse than no health check, so a DB blip degrades to 'ok' with the
 * error in `detail` rather than taking the cron down.
 */
export async function checkFleetHealth(): Promise<FleetHealth> {
  const since = new Date(Date.now() - WINDOW_MINUTES * 60_000)
  const day = utcDay()
  const defaultModelKey = resolveKey('auto')

  const base: FleetHealth = {
    status: 'ok',
    headline: 'Fleet healthy',
    detail: '',
    windowMinutes: WINDOW_MINUTES,
    aiReplies: 0,
    fallbacks: 0,
    defaultModelKey,
    defaultModelCallsToday: 0,
    agentCallsToday: 0,
  }

  try {
    const fallbackList = [...SILENT_AGENT_FALLBACKS]

    const [fallbacks, aiReplies, usageRows] = await Promise.all([
      db.widgetMessage.count({
        where: { role: 'agent', createdAt: { gte: since }, content: { in: fallbackList } },
      }),
      // A "real" AI reply: authored by the agent, not typed by a human
      // (sentByUserId null), and not one of the failure fallbacks.
      db.widgetMessage.count({
        where: {
          role: 'agent',
          createdAt: { gte: since },
          sentByUserId: null,
          content: { notIn: fallbackList },
        },
      }),
      db.llmUsageDaily.findMany({
        where: { day, surface: 'agent' },
        select: { modelKey: true, calls: true },
      }),
    ])

    const agentCallsToday = usageRows.reduce((n, r) => n + r.calls, 0)
    const defaultModelCallsToday = usageRows
      .filter(r => r.modelKey === defaultModelKey)
      .reduce((n, r) => n + r.calls, 0)

    const health: FleetHealth = {
      ...base, fallbacks, aiReplies, agentCallsToday, defaultModelCallsToday,
    }

    if (fallbacks >= MIN_FALLBACKS_FOR_OUTAGE && aiReplies === 0) {
      return {
        ...health,
        status: 'outage',
        headline: `AI has stopped answering — ${fallbacks} failed replies, 0 successful, last ${WINDOW_MINUTES}m`,
        detail:
          `Visitors are receiving the "agent hit a snag" fallback and being handed to humans. ` +
          `No AI reply has succeeded in ${WINDOW_MINUTES} minutes.\n\n` +
          `Most likely causes, in the order they have actually happened here:\n` +
          `  1. Anthropic credit balance exhausted (returns HTTP 400 "credit balance is too low").\n` +
          `  2. A provider credential missing on ONE Vercel project — the widget runtime has its own env, ` +
          `so a variable added only to the dashboard reaches none of the chat traffic.\n` +
          `  3. Both providers failing at once.\n\n` +
          `Check the xovera-widget runtime logs for "[llm]" and "[Agent] LLM call failed".`,
      }
    }

    // Only meaningful when the fleet default is NOT Claude; if Claude is the
    // default then "served by Claude" is the intended state, not a fallback.
    if (
      defaultModelKey !== CLAUDE_FALLBACK_KEY &&
      agentCallsToday >= MIN_AGENT_CALLS_FOR_DEGRADED &&
      defaultModelCallsToday === 0
    ) {
      return {
        ...health,
        status: 'degraded',
        headline: `${defaultModelKey} is serving nothing — every reply is falling back to Claude`,
        detail:
          `${agentCallsToday} agent calls today, none served by the configured default model ` +
          `"${defaultModelKey}". Every reply is being rescued by ${CLAUDE_FALLBACK_KEY}.\n\n` +
          `Customers are still being answered, so this is not urgent — but it costs several times ` +
          `the intended amount AND removes the fallback safety net, which is exactly how a routine ` +
          `billing lapse became a 32-hour outage on 2026-08-11.\n\n` +
          `Check the runtime logs for "[llm] CONFIG ERROR" (missing credential) or ` +
          `"[llm] ${defaultModelKey} failed" (provider rejecting calls).`,
      }
    }

    return {
      ...health,
      headline: `Fleet healthy — ${aiReplies} AI replies in the last ${WINDOW_MINUTES}m`,
      detail: '',
    }
  } catch (err) {
    return {
      ...base,
      detail: `health check could not run: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
