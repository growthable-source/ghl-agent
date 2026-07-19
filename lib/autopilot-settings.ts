/**
 * Auto-pilot mode settings loader.
 *
 * The six auto-pilot columns (wait time, max messages, image/voice gating,
 * bot-sleep) are applied by hand in production (SQL-by-hand workflow), so the
 * webhook can be running new code against a DB where the columns don't exist
 * yet. Every read here is wrapped so a missing column resolves to the safe
 * defaults (feature off / no cap) instead of throwing and dropping the
 * inbound. Once the migration is applied the real values flow through with no
 * code change.
 */
import { db } from './db'

export interface AutopilotSettings {
  /** Debounce/coalesce window in seconds. Null = the 3s default. */
  autopilotWaitSeconds: number | null
  /** Max agent messages per conversation before pausing. Null = uncapped. */
  maxBotMessages: number | null
  respondToImages: boolean
  respondToVoiceNotes: boolean
  sleepOnManualMessage: boolean
  sleepOnWorkflowMessage: boolean
}

export const AUTOPILOT_DEFAULTS: AutopilotSettings = {
  autopilotWaitSeconds: null,
  maxBotMessages: null,
  respondToImages: false,
  respondToVoiceNotes: false,
  sleepOnManualMessage: false,
  sleepOnWorkflowMessage: false,
}

/** Per-agent settings, safe against a pre-migration DB. */
export async function loadAutopilotSettings(agentId: string): Promise<AutopilotSettings> {
  try {
    const row = await db.agent.findUnique({
      where: { id: agentId },
      select: {
        autopilotWaitSeconds: true,
        maxBotMessages: true,
        respondToImages: true,
        respondToVoiceNotes: true,
        sleepOnManualMessage: true,
        sleepOnWorkflowMessage: true,
      },
    })
    if (!row) return AUTOPILOT_DEFAULTS
    return { ...AUTOPILOT_DEFAULTS, ...row }
  } catch {
    // Missing column (migration pending) or any transient read error →
    // behave exactly as the pre-feature code did.
    return AUTOPILOT_DEFAULTS
  }
}

/**
 * Inbound coalescing window for a location, in milliseconds. Widens the
 * debounce to the largest `autopilotWaitSeconds` configured among the
 * location's active agents (clamped to 60s), so "wait time before
 * responding" actually batches rapid messages. Falls back to `fallbackMs`
 * on a pre-migration DB or when no agent sets a wait.
 */
export async function resolveLocationWaitMs(locationId: string, fallbackMs: number): Promise<number> {
  try {
    const rows = await db.agent.findMany({
      where: { locationId, isActive: true },
      select: { autopilotWaitSeconds: true },
    })
    const maxWaitSec = rows.reduce((m, r) => Math.max(m, r.autopilotWaitSeconds ?? 0), 0)
    return maxWaitSec > 0 ? Math.min(maxWaitSec * 1000, 60_000) : fallbackMs
  } catch {
    return fallbackMs
  }
}

/**
 * Classify a GHL OutboundMessage by its send source. GHL's outbound webhook
 * carries extra fields our typed payload doesn't model — `userId` is present
 * on human/manual sends from the CRM UI, and `source` names the origin
 * ('workflow', 'campaign', 'bulk_actions', 'api', …). The agent's OWN replies
 * go out via the conversations API and come back as `source: 'api'` with no
 * user — those must NOT trigger a sleep, or the agent would pause itself after
 * every message.
 *
 * Returns 'manual' | 'workflow' | null (null = agent/api/unknown → ignore).
 */
export function classifyOutboundSource(payload: any): 'manual' | 'workflow' | null {
  const source = String(payload?.source ?? payload?.meta?.source ?? '').toLowerCase()
  const userId = payload?.userId ?? payload?.meta?.userId ?? payload?.user?.id ?? null

  // Automation/workflow/campaign/bulk sends — never carry a human user.
  if (/workflow|campaign|automation|bulk|trigger|drip/.test(source)) return 'workflow'

  // The agent's own send / generic API integration — explicitly ignore.
  if (source === 'api' || source === 'integration') return null

  // A real human operator sending from the CRM inbox. GHL stamps a userId on
  // these. Guard on the userId (not just source) so an unlabelled agent send
  // can't be misread as manual.
  if (userId && source !== 'app') return 'manual'
  if (userId && (source === 'app' || source === '')) return 'manual'

  return null
}
