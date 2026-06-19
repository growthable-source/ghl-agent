/**
 * Is a CRM connection actually live?
 *
 * Conversation Q&A mining only makes sense when the agent's CRM
 * (LeadConnector) is genuinely connected — a real location row with valid,
 * non-dead OAuth tokens. Placeholder (`placeholder:`) and built-in native
 * (`native:`) locations have no upstream conversation history to mine, and a
 * location whose refresh token has died (`tokenRefreshFailedAt` set) needs a
 * reconnect before any read will succeed.
 *
 * The mining entry point (button + API routes) is hidden / 403'd unless this
 * returns true, so this is the single gate the feature reuses everywhere.
 */

import { db } from '@/lib/db'

export interface CrmLiveStatus {
  live: boolean
  /** Machine-readable reason when not live, for UI copy. */
  reason?: 'no-location' | 'not-leadconnector' | 'no-token' | 'reconnect-required'
}

/**
 * True iff `locationId` points at a real, connected LeadConnector location:
 * crmProvider === 'ghl', non-empty access/refresh tokens, and no dead-token
 * flag. Synthetic locations (placeholder:/native:) are never live.
 */
export async function getCrmLiveStatus(locationId: string | null | undefined): Promise<CrmLiveStatus> {
  if (!locationId || locationId.startsWith('placeholder:') || locationId.startsWith('native:')) {
    return { live: false, reason: 'no-location' }
  }

  const loc = await db.location
    .findUnique({
      where: { id: locationId },
      select: { crmProvider: true, accessToken: true, refreshToken: true, tokenRefreshFailedAt: true },
    })
    .catch(() => null)

  if (!loc) return { live: false, reason: 'no-location' }
  if (loc.crmProvider !== 'ghl') return { live: false, reason: 'not-leadconnector' }
  if (!loc.accessToken || !loc.refreshToken) return { live: false, reason: 'no-token' }
  if (loc.tokenRefreshFailedAt) return { live: false, reason: 'reconnect-required' }
  return { live: true }
}

/** Convenience boolean wrapper around {@link getCrmLiveStatus}. */
export async function isCrmLive(locationId: string | null | undefined): Promise<boolean> {
  return (await getCrmLiveStatus(locationId)).live
}

/**
 * Resolve an agent's locationId and live status in one shot — the shape the
 * mining routes need (they key off agentId, not locationId).
 */
export async function getAgentCrmLiveStatus(
  agentId: string,
): Promise<CrmLiveStatus & { locationId: string | null }> {
  const agent = await db.agent
    .findUnique({ where: { id: agentId }, select: { locationId: true } })
    .catch(() => null)
  const locationId = agent?.locationId ?? null
  const status = await getCrmLiveStatus(locationId)
  return { ...status, locationId }
}
