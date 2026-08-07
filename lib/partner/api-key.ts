/**
 * Auth + rate limiting for the partner provisioning API.
 *
 * Split out of the routes because every partner endpoint needs the same
 * two gates and they are the only thing standing between a leaked key
 * and an unbounded run of account creation.
 */
import { AuthError, type KeyContext } from '@/lib/api-auth'

/**
 * Provisioning creates Users and Workspaces on behalf of many customers,
 * so it takes an ORG-scope key only. A workspace-scope key is by
 * definition bound to one tenant and has no business minting others.
 */
export function requirePartnerKey(key: KeyContext): void {
  if (key.scope !== 'org') {
    throw new AuthError(403, 'forbidden',
      'Partner provisioning requires an org-scope API key.')
  }
}

// In-process token bucket, same shape as the per-IP/per-slug caps on the
// public checkout route. Not distributed — each lambda has its own — so
// treat it as a blast-radius limiter on a leaked key, not a billing
// control. The real audit trail is ApiRequestLog.
const WINDOW_MS = 10 * 60 * 1000
const MAX_PER_WINDOW = 60
const hits = new Map<string, number[]>()

/**
 * Rate-limit writes per API key. /api/v1 sits outside middleware and had
 * no throttle at all; this is the first v1 route that creates accounts,
 * so an unbounded retry loop would otherwise fill the DB with orphan
 * workspaces.
 */
export function enforcePartnerRateLimit(key: KeyContext): void {
  const id = key.apiKeyId ?? 'unknown'
  const now = Date.now()
  const recent = (hits.get(id) ?? []).filter(t => now - t < WINDOW_MS)
  if (recent.length >= MAX_PER_WINDOW) {
    throw new AuthError(429, 'rate_limited',
      `Too many provisioning calls. Limit is ${MAX_PER_WINDOW} per ${WINDOW_MS / 60000} minutes.`)
  }
  recent.push(now)
  hits.set(id, recent)
  // Bound the map so a long-lived lambda seeing many keys can't grow it
  // without limit.
  if (hits.size > 500) {
    for (const [k, v] of hits) {
      if (v.every(t => now - t >= WINDOW_MS)) hits.delete(k)
    }
  }
}

/** Test seam. */
export function resetPartnerRateLimit(): void {
  hits.clear()
}
