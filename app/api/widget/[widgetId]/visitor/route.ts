import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { db } from '@/lib/db'
import { validateWidgetRequest, widgetCorsHeaders } from '@/lib/widget-auth'
import { sendVisitorRecoveryEmail } from '@/lib/widget-recovery-email'

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

  // ── Abandoned-conversation recovery ──────────────────────────────
  // If the visitor just handed us an email AND there's another
  // WidgetVisitor on this widget with the same email under a DIFFERENT
  // cookieId AND that visitor has an active/handed_off conversation,
  // they're almost certainly coming back from a different device or a
  // cleared cookie store. Issue a recovery magic link — clicking it
  // re-attaches the original visitor row to this new cookieId so the
  // conversation + operator assignment carry over.
  //
  // Best-effort — failures here never block the visitor's identify
  // flow. The conversation POST endpoint will just create a fresh
  // conversation under the new visitor row if recovery doesn't happen.
  let recoveryEmailed = false
  const normalizedEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : null
  if (normalizedEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    try {
      const priorVisitor = await db.widgetVisitor.findFirst({
        where: {
          widgetId,
          email: normalizedEmail,
          id: { not: visitor.id },
        },
        // Newest first — if there are multiple stale rows we want to
        // recover the most recent thread.
        orderBy: { lastSeenAt: 'desc' },
        include: {
          conversations: {
            where: { status: { in: ['active', 'handed_off'] } },
            select: { id: true },
            take: 1,
          },
        },
      })
      if (priorVisitor && priorVisitor.conversations.length > 0) {
        const token = randomBytes(24).toString('base64url')
        const expiresAt = new Date(Date.now() + 30 * 60_000) // 30 min
        await (db as any).visitorRecoveryToken.create({
          data: {
            token,
            visitorId: priorVisitor.id,
            widgetId,
            email: normalizedEmail,
            expiresAt,
          },
        })
        const widgetRow = await db.chatWidget.findUnique({
          where: { id: widgetId },
          select: { name: true, primaryColor: true, publicKey: true },
        })
        const base = process.env.NEXT_PUBLIC_APP_URL || ''
        const recoverUrl = `${base}/widget/${widgetId}/embed?pk=${encodeURIComponent(widgetRow?.publicKey || '')}&recover=${token}`
        await sendVisitorRecoveryEmail({
          to: normalizedEmail,
          visitorName: priorVisitor.name,
          widgetName: widgetRow?.name || 'our chat',
          recoverUrl,
          primaryColor: widgetRow?.primaryColor,
        })
        recoveryEmailed = true
      }
    } catch (err: any) {
      // Missing table (pre-migration) or any other glitch: log + move on.
      console.warn('[visitor] recovery probe failed:', err?.message)
    }
  }

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
    // Surface so the widget UI can show "we sent you a link — check
    // your email to resume the chat from your previous device."
    recoveryEmailed,
  }, { headers })
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip + (process.env.IP_HASH_SALT || ''))
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf)).slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('')
}
