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
 * POST /api/widget/:widgetId/recover
 * Body: { token, newCookieId }
 *
 * Magic-link consumer. The visitor lands on the embed page with
 * ?recover=<token>; the widget calls this endpoint with the token
 * AND the fresh cookieId from the new device's localStorage. We:
 *
 *   1. Validate the token (unused, not expired, scoped to this widget)
 *   2. Re-point the ORIGINAL visitor row at the new cookieId
 *   3. Delete the placeholder visitor row the new device just created
 *      (if any), to avoid orphans
 *   4. Mark the token used
 *
 * Returns the visitorId the widget should now use. Conversation
 * resumes naturally because the new cookieId now resolves to the
 * original WidgetVisitor row.
 *
 * Single-use. Idempotency: a usedAt-stamped token returns 410.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { widgetId } = await params
  const v = await validateWidgetRequest(req, widgetId)
  const headers = widgetCorsHeaders(req.headers.get('origin'))
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: v.status, headers })

  let body: any = {}
  try { body = await req.json() } catch {}
  const token = typeof body.token === 'string' ? body.token : null
  const newCookieId = typeof body.newCookieId === 'string' ? body.newCookieId.slice(0, 64) : null
  if (!token || !newCookieId) {
    return NextResponse.json({ error: 'token and newCookieId required' }, { status: 400, headers })
  }

  let recoveryToken: any
  try {
    recoveryToken = await (db as any).visitorRecoveryToken.findUnique({
      where: { token },
      include: {
        visitor: {
          select: { id: true, cookieId: true, widgetId: true, email: true, name: true },
        },
      },
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || /relation .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({
        error: 'Recovery not yet available — pending migration',
        code: 'MIGRATION_PENDING',
      }, { status: 503, headers })
    }
    throw err
  }

  if (!recoveryToken) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404, headers })
  }
  if (recoveryToken.usedAt) {
    return NextResponse.json({ error: 'token_already_used' }, { status: 410, headers })
  }
  if (recoveryToken.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'token_expired' }, { status: 410, headers })
  }
  // Belt-and-braces: enforce the widget scope on the server side too,
  // even though the URL already constrains it.
  if (recoveryToken.widgetId !== widgetId || recoveryToken.visitor?.widgetId !== widgetId) {
    return NextResponse.json({ error: 'invalid_token' }, { status: 404, headers })
  }

  // If the original visitor still has the same cookieId (the visitor
  // never moved), the recover is a no-op — return the existing id.
  if (recoveryToken.visitor.cookieId === newCookieId) {
    await (db as any).visitorRecoveryToken.update({
      where: { id: recoveryToken.id },
      data: { usedAt: new Date() },
    })
    return NextResponse.json({ visitorId: recoveryToken.visitor.id }, { headers })
  }

  // Swap the cookieId on the original visitor row + remove the
  // placeholder row created by the new device (if it exists, by the
  // new cookieId on this widget) so there's no orphan.
  // Wrapped in a transaction: the unique constraint on
  // (widgetId, cookieId) means both writes have to commit atomically
  // or one will fail when we move the original onto the new cookie.
  try {
    await db.$transaction(async (tx) => {
      // Drop the placeholder if it exists. Using deleteMany so a
      // missing row is silent.
      await tx.widgetVisitor.deleteMany({
        where: { widgetId, cookieId: newCookieId },
      })
      await tx.widgetVisitor.update({
        where: { id: recoveryToken.visitor.id },
        data: {
          cookieId: newCookieId,
          lastSeenAt: new Date(),
        },
      })
      await (tx as any).visitorRecoveryToken.update({
        where: { id: recoveryToken.id },
        data: { usedAt: new Date() },
      })
    })
  } catch (err: any) {
    console.warn('[recover] swap failed:', err?.message)
    return NextResponse.json({ error: 'recover_failed' }, { status: 500, headers })
  }

  return NextResponse.json({
    visitorId: recoveryToken.visitor.id,
    email: recoveryToken.visitor.email,
    name: recoveryToken.visitor.name,
  }, { headers })
}
