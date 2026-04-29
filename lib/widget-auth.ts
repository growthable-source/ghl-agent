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

/**
 * Pull a widget row with an explicit select. Two reasons:
 *   1. Migration tolerance — if any newly-added column (brandId,
 *      routingMode, etc.) hasn't been applied to production yet,
 *      Prisma's default `findUnique` fails entirely with
 *      `column does not exist` because it SELECT *s. An explicit
 *      list lets the widget keep loading on partially-migrated DBs;
 *      anything not in the list degrades to a sensible default.
 *   2. Performance / privacy — we don't need the entire row; the
 *      caller only ever reads the fields below.
 *
 * If a new feature adds a column the widget needs at config-load time,
 * add it here behind a try/catch so a missing migration doesn't take
 * down every customer's widget.
 */
async function loadWidget(widgetId: string) {
  // Try the full select first — what current code expects.
  try {
    return await db.chatWidget.findUnique({
      where: { id: widgetId },
      select: {
        id: true, name: true, publicKey: true, isActive: true,
        primaryColor: true, logoUrl: true, title: true, subtitle: true,
        welcomeMessage: true, position: true,
        type: true, slug: true, embedMode: true,
        buttonLabel: true, buttonShape: true, buttonSize: true,
        buttonIcon: true, buttonTextColor: true,
        hostedPageHeadline: true, hostedPageSubtext: true,
        requireEmail: true, askForNameEmail: true,
        voiceEnabled: true, voiceAgentId: true,
        defaultAgentId: true, allowedDomains: true,
        workspaceId: true,
      } as any,
    })
  } catch (err: any) {
    // A column the new schema expects doesn't exist on this DB yet
    // (migration pending). Retry with the smallest possible select
    // that's been around since the base widget migration so the
    // launcher still loads.
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      const fallback = await db.chatWidget.findUnique({
        where: { id: widgetId },
        select: {
          id: true, name: true, publicKey: true, isActive: true,
          primaryColor: true, logoUrl: true, title: true, subtitle: true,
          welcomeMessage: true, position: true,
          requireEmail: true, askForNameEmail: true,
          voiceEnabled: true, voiceAgentId: true,
          defaultAgentId: true, allowedDomains: true,
          workspaceId: true,
        },
      })
      if (!fallback) return null
      // Pad in the click-to-call defaults so callers reading those
      // fields don't break. Older deployments are effectively
      // chat-only widgets in floating mode.
      return {
        ...fallback,
        type: 'chat',
        slug: null,
        embedMode: 'floating',
        buttonLabel: 'Talk to us',
        buttonShape: 'pill',
        buttonSize: 'md',
        buttonIcon: 'phone',
        buttonTextColor: '#ffffff',
        hostedPageHeadline: null,
        hostedPageSubtext: null,
      } as any
    }
    throw err
  }
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
