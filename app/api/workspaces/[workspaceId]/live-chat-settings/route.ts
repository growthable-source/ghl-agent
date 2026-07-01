import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { getLiveChatSettings } from '@/lib/livechat-settings'

type Params = { params: Promise<{ workspaceId: string }> }

export const dynamic = 'force-dynamic'

// GET — current workspace live-chat / queue settings (with defaults).
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const settings = await getLiveChatSettings(workspaceId)
  return NextResponse.json({ settings })
}

// PATCH — upsert the settings. Owner/admin only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (access.role !== 'owner' && access.role !== 'admin') {
    return NextResponse.json({ error: 'Only owners and admins can change live-chat settings.' }, { status: 403 })
  }

  let body: any = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.queueEnabled === 'boolean') data.queueEnabled = body.queueEnabled
  if (typeof body.queueGameEnabled === 'boolean') data.queueGameEnabled = body.queueGameEnabled
  if (typeof body.queueEmailTicketEnabled === 'boolean') data.queueEmailTicketEnabled = body.queueEmailTicketEnabled
  if (typeof body.maxConcurrentHumanChats === 'number' && Number.isFinite(body.maxConcurrentHumanChats)) {
    data.maxConcurrentHumanChats = Math.max(1, Math.min(1000, Math.floor(body.maxConcurrentHumanChats)))
  }
  if (body.queueMessage === null || typeof body.queueMessage === 'string') {
    data.queueMessage = body.queueMessage ? String(body.queueMessage).trim().slice(0, 1000) || null : null
  }
  if (typeof body.escalateAfterMinutes === 'number' && Number.isFinite(body.escalateAfterMinutes)) {
    // 0 = off; cap at 24h so a typo can't push escalation absurdly far out.
    data.escalateAfterMinutes = Math.max(0, Math.min(1440, Math.floor(body.escalateAfterMinutes)))
  }
  if (typeof body.escalateReassign === 'boolean') data.escalateReassign = body.escalateReassign
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No mutable fields' }, { status: 400 })
  }

  try {
    await (db as any).liveChatSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...data },
      update: data,
    })
  } catch (err: any) {
    if (err?.code === 'P2021' || err?.code === 'P2022' || /does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ error: 'Live-chat settings table not migrated yet.', code: 'MIGRATION_PENDING' }, { status: 503 })
    }
    throw err
  }

  const settings = await getLiveChatSettings(workspaceId)
  return NextResponse.json({ settings })
}
