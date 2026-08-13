/**
 * Storm control for infrastructure-class notifications.
 *
 * Some events describe the deployment, not a conversation, so they arrive once
 * per failed message during an incident. `agent_error` defaults to email for
 * every workspace member, which means a provider outage does not send one
 * alert — it sends (failures x members) alerts, to the customer's whole team,
 * describing a fault only we can fix. The 2026-08-11 outage produced roughly
 * 900 such emails across tenants while the actual cause went unnoticed.
 *
 * The first occurrence in each window goes out in full. The rest are dropped:
 * the tenth identical "agent failed" email adds nothing the first did not
 * already say.
 *
 * Deliberately in-memory, and deliberately not the operator's guarantee of
 * being told. It collapses a storm within a warm instance — where essentially
 * all the volume is, since a burst of failures is served by instances already
 * warm — and costs no schema change. The durable signal is lib/fleet-health.ts,
 * which reads the database every 5 minutes and cannot be defeated by instance
 * recycling. Lives in its own module (no `db` import) so it stays unit-testable
 * under a harness that excludes anything touching Prisma.
 */

export const STORM_CONTROLLED_EVENTS = new Set(['agent_error'])
export const STORM_WINDOW_MS = 15 * 60_000
const STORM_KEYS_MAX = 5_000

const lastNotifiedAt = new Map<string, number>()

/**
 * True when this notification should be dropped as a repeat within the window.
 * Records the send as a side effect when it returns false.
 *
 * `now` is injectable so the behaviour can be tested without sleeping.
 */
export function isStormSuppressed(
  event: string,
  workspaceId: string,
  targetUserId?: string,
  now: number = Date.now(),
): boolean {
  if (!STORM_CONTROLLED_EVENTS.has(event)) return false
  const key = `${workspaceId}:${event}:${targetUserId ?? '*'}`
  const prev = lastNotifiedAt.get(key)
  if (prev !== undefined && now - prev < STORM_WINDOW_MS) return true

  // Bound the map so a long-lived instance cannot grow it without limit.
  if (lastNotifiedAt.size >= STORM_KEYS_MAX) {
    for (const [k, t] of lastNotifiedAt) {
      if (now - t >= STORM_WINDOW_MS) lastNotifiedAt.delete(k)
    }
    if (lastNotifiedAt.size >= STORM_KEYS_MAX) lastNotifiedAt.clear()
  }
  lastNotifiedAt.set(key, now)
  return false
}

/** Test seam: forget all recorded sends. */
export function resetStormControl(): void {
  lastNotifiedAt.clear()
}
