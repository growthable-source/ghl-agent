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
 * POST /api/widget/:widgetId/visitor
 * Body: { cookieId, email?, name?, phone? }
 *
 * Upserts a WidgetVisitor keyed by (widgetId, cookieId). Returns the
 * visitorId. The widget stores cookieId in localStorage so returning
 * visitors get the same identity.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const cookieId = typeof body.cookieId === 'string' ? body.cookieId.slice(0, 64) : null
  if (!cookieId) return NextResponse.json({ error: 'cookieId required' }, { status: 400, headers })

  const userAgent = req.headers.get('user-agent')?.slice(0, 300) ?? null
  // Hash the IP for privacy; we just need it for abuse signals, not identity
  const rawIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ipAddress = rawIp ? await hashIp(rawIp) : null

  const visitor = await db.widgetVisitor.upsert({
    where: { widgetId_cookieId: { widgetId, cookieId } },
    create: {
      widgetId,
      cookieId,
      email: body.email || null,
      name: body.name || null,
      phone: body.phone || null,
      userAgent,
      ipAddress,
    },
    update: {
      lastSeenAt: new Date(),
      ...(body.email ? { email: body.email } : {}),
      ...(body.name ? { name: body.name } : {}),
      ...(body.phone ? { phone: body.phone } : {}),
    },
  })

  // Sync into GHL when we have an email/phone and a real CRM is connected.
  // Best-effort — errors don't break the visitor flow, and there's nothing
  // to do for workspaces without a real CRM hookup.
  if ((visitor.email || visitor.phone) && !visitor.crmContactId) {
    try {
      const widget = await db.chatWidget.findUnique({
        where: { id: widgetId },
        select: { workspaceId: true },
      })
      if (widget) {
        const { syncContactFromVisitor } = await import('@/lib/widget-crm-sync')
        // Fire-and-forget so we don't slow the visitor's identity step.
        syncContactFromVisitor(widget.workspaceId, visitor as any).catch(() => {})
      }
    } catch { /* swallowed — best-effort */ }
  }

  return NextResponse.json({
    visitorId: visitor.id,
    email: visitor.email,
    name: visitor.name,
  }, { headers })
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + (process.env.IP_HASH_SALT || ''))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}
