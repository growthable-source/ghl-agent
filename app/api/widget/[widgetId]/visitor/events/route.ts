import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'

type Params = { params: Promise<{ widgetId: string }> }

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, {
    status: 204,
    headers: widgetCorsHeaders(req.headers.get('origin')),
  })
}

/**
 * POST /api/widget/:widgetId/visitor/events
 *
 * Visitor activity ingest. Called by the widget JS on the host page
 * whenever something interesting happens (page_view, identify, etc.).
 *
 * Body: { cookieId, kind, data }
 *   - kind: 'page_view' | 'identify' | 'custom'
 *   - data: kind-specific JSON
 *      page_view: { url, title?, referrer?, search? }
 *      identify:  { email?, name?, phone? }
 *
 * Best-effort — visitor's chat experience never blocks on an event
 * write. Bad payloads are silently rejected; the widget retries with
 * the next event.
 */
const MAX_EVENTS_PER_VISITOR_PER_HOUR = 200
const ALLOWED_KINDS = new Set(['page_view', 'identify', 'custom'])

export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const cookieId = typeof body.cookieId === 'string' ? body.cookieId.slice(0, 64) : null
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!cookieId) return NextResponse.json({ error: 'cookieId required' }, { status: 400, headers })
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'kind must be page_view | identify | custom' }, { status: 400, headers })
  }

  const visitor = await db.widgetVisitor.findUnique({
    where: { widgetId_cookieId: { widgetId, cookieId } },
    select: { id: true },
  })
  if (!visitor) {
    // The widget calls /visitor (identify) before any /events fire, so
    // this should be rare. Return 200 so the widget doesn't keep
    // retrying — log and move on.
    return NextResponse.json({ ok: true, skipped: 'no-visitor' }, { headers })
  }

  // Cheap rate-limit: cap events per visitor per hour. Prevents a
  // misbehaving SPA from hammering us on every router transition.
  try {
    const recent = await (db as any).widgetVisitorEvent.count({
      where: { visitorId: visitor.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
    })
    if (recent >= MAX_EVENTS_PER_VISITOR_PER_HOUR) {
      return NextResponse.json({ ok: true, throttled: true }, { headers })
    }
  } catch { /* migration pending — skip the count */ }

  const data = sanitizeEventData(kind, body.data)

  // Only persist a page_view if it's a *new* page — repeated events
  // for the same URL within 60s are de-duped so SPA bursts don't
  // pollute the timeline.
  if (kind === 'page_view') {
    const url = (data.url as string) || ''
    const lastEvent = await (db as any).widgetVisitorEvent.findFirst({
      where: { visitorId: visitor.id, kind: 'page_view' },
      orderBy: { createdAt: 'desc' },
      select: { data: true, createdAt: true },
    }).catch((err: any) => {
      console.warn('[visitor-events] dedupe lookup failed:', err?.message)
      return null
    })
    const sameUrl = lastEvent?.data?.url === url
    const tooSoon = lastEvent && Date.now() - new Date(lastEvent.createdAt).getTime() < 60_000
    if (sameUrl && tooSoon) {
      // Update lastSeen on the visitor but don't write a new event row.
      // We log failures rather than block the visitor's request — the
      // chat path can't get blocked on this metadata write.
      await db.widgetVisitor.update({
        where: { id: visitor.id },
        data: { lastSeenAt: new Date() },
      }).catch((err: any) => console.warn('[visitor-events] lastSeen update failed:', err?.message))
      return NextResponse.json({ ok: true, deduped: true }, { headers })
    }

    // Store + keep the visitor's "current page" denormalized for
    // fast inbox display. Updates on every new page hit.
    await Promise.all([
      (db as any).widgetVisitorEvent.create({
        data: { visitorId: visitor.id, kind, data },
      }),
      db.widgetVisitor.update({
        where: { id: visitor.id },
        data: {
          currentUrl: url || null,
          currentTitle: typeof data.title === 'string' ? data.title.slice(0, 200) : null,
          lastSeenAt: new Date(),
        } as any,
      }).catch((err: any) => console.warn('[visitor-events] currentPage update failed:', err?.message)),
    ])
    return NextResponse.json({ ok: true }, { headers })
  }

  // Other kinds: just persist + bump lastSeenAt.
  await Promise.all([
    (db as any).widgetVisitorEvent.create({
      data: { visitorId: visitor.id, kind, data },
    }).catch((err: any) => console.warn('[visitor-events] event create failed:', err?.message)),
    db.widgetVisitor.update({
      where: { id: visitor.id },
      data: { lastSeenAt: new Date() },
    }).catch((err: any) => console.warn('[visitor-events] lastSeen update failed:', err?.message)),
  ])
  return NextResponse.json({ ok: true }, { headers })
}

/**
 * Whitelist + cap event payload fields so nothing arbitrary lands in
 * the JSON column. Keeps the timeline clean and the database small.
 */
function sanitizeEventData(kind: string, raw: any): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, unknown> = {}
  if (kind === 'page_view') {
    if (typeof raw.url === 'string')      out.url      = raw.url.slice(0, 2000)
    if (typeof raw.title === 'string')    out.title    = raw.title.slice(0, 300)
    if (typeof raw.referrer === 'string') out.referrer = raw.referrer.slice(0, 2000)
    if (typeof raw.search === 'string')   out.search   = raw.search.slice(0, 1000)
    if (typeof raw.path === 'string')     out.path     = raw.path.slice(0, 1000)
  } else if (kind === 'identify') {
    if (typeof raw.email === 'string') out.email = raw.email.slice(0, 200)
    if (typeof raw.name === 'string')  out.name  = raw.name.slice(0, 200)
    if (typeof raw.phone === 'string') out.phone = raw.phone.slice(0, 50)
  } else if (kind === 'custom') {
    // For custom events, accept up to 8 string/number/boolean fields
    // and stringify-cap each. Caller controls keys; we just enforce
    // shape + size so nobody dumps a 10 MB blob.
    let count = 0
    for (const [k, v] of Object.entries(raw)) {
      if (count >= 8) break
      if (typeof v === 'string')  { out[k] = v.slice(0, 1000); count++ }
      else if (typeof v === 'number' || typeof v === 'boolean') { out[k] = v; count++ }
    }
  }
  return out
}
