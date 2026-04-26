import { db } from './db'

/**
 * Validate that a request targeting /api/widget/[widgetId]/... is allowed.
 * Checks:
 *   1. Widget exists and is active
 *   2. publicKey (sent as Authorization: Bearer or ?pk= query) matches
 *   3. Origin header is in allowedDomains (if any are configured)
 *
 * Returns the loaded widget on success, or { error, status } on failure.
 */

type ValidationResult =
  | { ok: true; widget: Awaited<ReturnType<typeof loadWidget>> & NonNullable<unknown> }
  | { ok: false; error: string; status: number }

async function loadWidget(widgetId: string) {
  return db.chatWidget.findUnique({ where: { id: widgetId } })
}

function extractPublicKey(req: Request): string | null {
  const auth = req.headers.get('authorization') || ''
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim()
  const url = new URL(req.url)
  return url.searchParams.get('pk')
}

function isOurOrigin(origin: string): boolean {
  const app = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || ''
  if (!app) return false
  try { return new URL(origin).host.toLowerCase() === new URL(app).host.toLowerCase() } catch { return false }
}

function originMatches(origin: string, allowed: string[]): boolean {
  if (allowed.length === 0) return true
  try {
    const host = new URL(origin).host.toLowerCase()
    return allowed.some(d => {
      const dom = d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '')
      if (!dom) return false
      if (dom === host) return true
      // Support wildcard subdomain: "*.example.com"
      if (dom.startsWith('*.')) {
        const base = dom.slice(2)
        return host === base || host.endsWith('.' + base)
      }
      return host.endsWith('.' + dom) // parent-domain match
    })
  } catch {
    return false
  }
}

export async function validateWidgetRequest(
  req: Request,
  widgetId: string,
): Promise<ValidationResult> {
  const widget = await loadWidget(widgetId)
  if (!widget) return { ok: false, error: 'Widget not found', status: 404 }
  if (!widget.isActive) return { ok: false, error: 'Widget is disabled', status: 403 }

  const providedKey = extractPublicKey(req)
  if (providedKey !== widget.publicKey) {
    return { ok: false, error: 'Invalid public key', status: 401 }
  }

  const origin = req.headers.get('origin')
  if (origin && !isOurOrigin(origin) && !originMatches(origin, widget.allowedDomains)) {
    return { ok: false, error: `Origin ${origin} not allowed for this widget`, status: 403 }
  }

  return { ok: true, widget }
}

/**
 * CORS helper — widget API endpoints must allow the host site to call us.
 * Echo back the request origin if the widget allows it, otherwise "*".
 */
export function widgetCorsHeaders(origin: string | null, allowedDomains: string[] = []): Record<string, string> {
  const allowOrigin = origin && (allowedDomains.length === 0 || originMatches(origin, allowedDomains))
    ? origin
    : '*'
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

export function generatePublicKey(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return 'widget_pub_' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}
