import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * POST  → register a browser push subscription for the calling user.
 *         Body: { endpoint, keys: { p256dh, auth }, userAgent? }
 *         Idempotent — keyed by endpoint, so re-registering from the
 *         same browser updates the existing row.
 *
 * DELETE → remove this subscription (the page sends `endpoint` as a
 *          query param when the user toggles browser push off).
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id!

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const endpoint: string = body.endpoint
  const p256dh: string = body.keys?.p256dh
  const auth: string = body.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ error: 'endpoint + keys.p256dh + keys.auth required' }, { status: 400 })
  }

  const userAgent = (body.userAgent || req.headers.get('user-agent') || '').slice(0, 300) || null
  try {
    // Endpoint is unique → swap any prior owner of this endpoint to the
    // current user (handles browser-shared devices). Update keys + ua.
    const existing = await (db as any).webPushSubscription.findUnique({ where: { endpoint } })
    if (existing) {
      await (db as any).webPushSubscription.update({
        where: { endpoint },
        data: { userId, workspaceId, p256dh, auth, userAgent, lastUsedAt: new Date() },
      })
    } else {
      await (db as any).webPushSubscription.create({
        data: { userId, workspaceId, endpoint, p256dh, auth, userAgent },
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Browser push', 'manual_per_user_notifications.sql')
    return NextResponse.json({ error: err.message || 'Could not save subscription' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id!

  const endpoint = new URL(req.url).searchParams.get('endpoint')
  if (!endpoint) return NextResponse.json({ error: 'endpoint query param required' }, { status: 400 })

  try {
    await (db as any).webPushSubscription.deleteMany({
      where: { endpoint, userId, workspaceId },
    })
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    if (isMissingColumn(err)) return NextResponse.json({ ok: true, notMigrated: true })
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
