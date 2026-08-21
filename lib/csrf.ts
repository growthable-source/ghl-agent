import type { NextRequest } from 'next/server'

/**
 * Lightweight CSRF defence for cookie-authenticated, state-changing routes.
 *
 * The portal embed cookie is SameSite=None (it has to ride inside the
 * marketplace iframe), so browsers attach it on cross-site requests too — a
 * classic CSRF exposure. Our own client always fetches same-origin (relative
 * URLs from the portal page, whose document origin IS the app), so a
 * cross-origin Origin header means the request did NOT come from our UI.
 *
 * Returns true when the request is cross-site and should be refused. Absent
 * Origin → allowed (some same-origin POSTs omit it; the session cookie still
 * gates access).
 */
export function isCrossSiteRequest(req: NextRequest): boolean {
  const origin = req.headers.get('origin')
  if (!origin) return false
  const host = req.headers.get('host')
  if (!host) return false
  try {
    return new URL(origin).host !== host
  } catch {
    return true // unparseable Origin → treat as hostile
  }
}
