import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { NOTIFICATION_EVENTS, SUPPORTED_USER_CHANNELS, defaultPreferenceFor } from '@/lib/notification-events'
import { isMissingColumn, migrationPendingResponse } from '@/lib/migration-error'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET    → returns the calling user's per-event channel preferences,
 *          merged with sensible defaults for events the user hasn't
 *          touched yet. Always returns the full event catalog so the
 *          UI doesn't need to know it independently.
 *
 * PATCH  → upsert one event's channels.
 *          Body: { event: "<id>", channels: ["email","web_push"] }
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id!

  let stored: Array<{ event: string; channels: string[] }> = []
  let notMigrated = false
  try {
    stored = await (db as any).userNotificationPreference.findMany({
      where: { userId, workspaceId },
      select: { event: true, channels: true },
    })
  } catch (err: any) {
    if (isMissingColumn(err)) notMigrated = true
    else throw err
  }

  const storedByEvent = new Map(stored.map(s => [s.event, s.channels]))
  const events = NOTIFICATION_EVENTS.map(def => ({
    id: def.id,
    label: def.label,
    description: def.description,
    channels: storedByEvent.get(def.id) ?? defaultPreferenceFor(def.id),
    isDefault: !storedByEvent.has(def.id),
  }))

  return NextResponse.json({
    events,
    supportedChannels: SUPPORTED_USER_CHANNELS,
    notMigrated,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const userId = access.session.user!.id!

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }
  const event = String(body.event || '').trim()
  if (!event || !NOTIFICATION_EVENTS.find(e => e.id === event)) {
    return NextResponse.json({ error: 'Unknown event id' }, { status: 400 })
  }
  const requested: string[] = Array.isArray(body.channels) ? body.channels : []
  const channels = requested.filter(c => (SUPPORTED_USER_CHANNELS as readonly string[]).includes(c))

  try {
    await (db as any).userNotificationPreference.upsert({
      where: { userId_workspaceId_event: { userId, workspaceId, event } },
      create: { userId, workspaceId, event, channels },
      update: { channels },
    })
    return NextResponse.json({ ok: true, event, channels })
  } catch (err: any) {
    if (isMissingColumn(err)) return migrationPendingResponse('Notification preferences', 'manual_per_user_notifications.sql')
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
