/**
 * Shared client for the consolidated /heartbeat poll.
 *
 * Three chrome components poll background state on their own cadences
 * (HandoffAlertBanner 12s, NewChatAlert 10s, useNavCounts 30s). They
 * all call fetchHeartbeat(); concurrent and near-in-time calls collapse
 * onto one in-flight network request via a module-level TTL cache, so
 * a tab makes at most ~1 heartbeat request per TTL window no matter
 * how many consumers poll.
 *
 * Consumers parse the raw sub-payloads exactly as they parsed the
 * individual endpoints: { attention, approvals, unread, recent }.
 */

export interface HeartbeatPayload {
  attention: { items?: any[]; summary?: Record<string, number> } | null
  approvals: { count?: number; items?: any[] } | null
  unread: { count?: number } | null
  recent: { chats?: any[] } | null
}

const TTL_MS = 8_000

let cache: { workspaceId: string; ts: number; promise: Promise<HeartbeatPayload | null> } | null = null

export function fetchHeartbeat(workspaceId: string): Promise<HeartbeatPayload | null> {
  const now = Date.now()
  if (cache && cache.workspaceId === workspaceId && now - cache.ts < TTL_MS) {
    return cache.promise
  }
  const promise = fetch(`/api/workspaces/${workspaceId}/heartbeat`, { cache: 'no-store' })
    .then(r => (r.ok ? (r.json() as Promise<HeartbeatPayload>) : null))
    .catch(() => null)
  cache = { workspaceId, ts: now, promise }
  return promise
}
