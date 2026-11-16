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

  // The widget sends the JSON body as text/plain — a beacon with an
  // application/json content type needs a CORS preflight that beacons
  // can't perform, so browsers silently dropped every cross-origin
  // event (= every real customer site) until the transport switched.
  // req.text() + JSON.parse handles both content types.
  let body: any = {}
  try { body = JSON.parse(await req.text()) } catch {}
  const cookieId = typeof body.cookieId === 'string' ? body.cookieId.slice(0, 64) : null
  const kind = typeof body.kind === 'string' ? body.kind : ''
  if (!cookieId) return NextResponse.json({ error: 'cookieId required' }, { status: 400, headers })
  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'kind must be page_view | identify | custom' }, { status: 400, headers })
  }

  // For page_view events we auto-create the visitor row on first
  // contact. The widget tracks page activity from the moment widget.js
  // loads — often well before the visitor opens the chat (which is
  // when /visitor identify normally fires). Without this branch, every
  // page_view a visitor generates BEFORE opening the chat is silently
  // dropped. That's the bug behind "I can see the chat but no page
  // history on the visitor."
  //
  // For non-page_view events we keep the old "no-visitor → skip"
  // semantics, since identify and custom events should not implicitly
  // create rows (caller bugs would otherwise pollute the DB).
  let visitor = await db.widgetVisitor.findUnique({
    where: { widgetId_cookieId: { widgetId, cookieId } },
    select: { id: true },
  })
  if (!visitor && kind === 'page_view') {
    const userAgent = req.headers.get('user-agent')?.slice(0, 300) ?? null
    try {
      visitor = await db.widgetVisitor.upsert({
        where: { widgetId_cookieId: { widgetId, cookieId } },
        create: { widgetId, cookieId, userAgent },
        update: { lastSeenAt: new Date() },
        select: { id: true },
      })
    } catch (err: any) {
      console.warn('[visitor-events] auto-create failed:', err?.message)
    }
  }
  if (!visitor) {
    return NextResponse.json({ ok: true, skipped: 'no-visitor' }, { headers })
  }

  const data = sanitizeEventData(kind, body.data)

  // Hourly cap for identify/custom only. page_view is the vast majority
  // of this route (millions of calls) and already collapses same-URL
  // bursts below; a COUNT(*) on every one of those was one of the
  // hottest statements in the project and transferred nothing useful.
  // The cap check that remains reads at most MAX ids and stops — it
  // does not count the whole hour.
  if (kind !== 'page_view') {
    try {
      const recent = await (db as any).widgetVisitorEvent.findMany({
        where: { visitorId: visitor.id, createdAt: { gte: new Date(Date.now() - 3600_000) } },
        select: { id: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_EVENTS_PER_VISITOR_PER_HOUR,
      })
      if (recent.length >= MAX_EVENTS_PER_VISITOR_PER_HOUR) {
        return NextResponse.json({ ok: true, throttled: true }, { headers })
      }
    } catch { /* migration pending — skip the cap */ }
  }

  // Only persist a page_view if it's a *new* page — repeated events
  // for the same URL within 60s are de-duped so SPA bursts don't
  // pollute the timeline. The previous row's jsonb `data` is not
  // needed; the URL alone answers the comparison.
  if (kind === 'page_view') {
    const url = (data.url as string) || ''
    const lastEvent = await db.$queryRaw<Array<{ url: string | null; createdAt: Date }>>`
      SELECT "data"->>'url' AS url, "createdAt"
      FROM "WidgetVisitorEvent"
      WHERE "visitorId" = ${visitor.id} AND "kind" = 'page_view'
      ORDER BY "createdAt" DESC
      LIMIT 1
    `.catch((err: any) => {
      console.warn('[visitor-events] dedupe lookup failed:', err?.message)
      return [] as Array<{ url: string | null; createdAt: Date }>
    })
    const previous = lastEvent[0]
    // Compare the raw extracted URL. A missing key comes back as null,
    // and `null === ''` stays false — same as the old `data.url === url`
    // check when the field was absent.
    const sameUrl = previous?.url === url
    const tooSoon = previous && Date.now() - new Date(previous.createdAt).getTime() < 60_000
    if (sameUrl && tooSoon) {
      // Update lastSeen on the visitor but don't write a new event row.
      // updateMany returns a count, not the row — the caller only needs
      // to know the write was attempted.
      await db.widgetVisitor.updateMany({
        where: { id: visitor.id },
        data: { lastSeenAt: new Date() },
      }).catch((err: any) => console.warn('[visitor-events] lastSeen update failed:', err?.message))
      return NextResponse.json({ ok: true, deduped: true }, { headers })
    }

    // Store + keep the visitor's "current page" denormalized for
    // fast inbox display. Updates on every new page hit.
    // createMany / updateMany so Postgres does not RETURNING the
    // jsonb payload or the full visitor row on this hot path.
    await Promise.all([
      (db as any).widgetVisitorEvent.createMany({
        data: [{ visitorId: visitor.id, kind, data }],
      }),
      db.widgetVisitor.updateMany({
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
    (db as any).widgetVisitorEvent.createMany({
      data: [{ visitorId: visitor.id, kind, data }],
    }).catch((err: any) => console.warn('[visitor-events] event create failed:', err?.message)),
    db.widgetVisitor.updateMany({
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
