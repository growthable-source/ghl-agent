import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { can } from '@/lib/permissions'
import { getTicketingStatus } from '@/lib/ticketing-access'
import { loadRoutableMemberIds, parseTicketRoutingBody } from '@/lib/ticket-routing'

type Params = { params: Promise<{ workspaceId: string }> }

/**
 * GET  — return current settings + combined access status.
 * PATCH — update settings. Admins/owners only. Enabling requires
 *         the plan to allow it (server enforces — UI also gates).
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const [settings, status] = await Promise.all([
    (db as any).ticketingSettings.findUnique({ where: { workspaceId } }).catch(() => null),
    getTicketingStatus(workspaceId),
  ])

  return NextResponse.json({
    settings: settings ?? {
      enabled: false,
      autoCloseAfterDays: 7,
      autoReopenOnReply: true,
      fromEmail: null,
      fromName: null,
      signature: null,
      defaultTicketRoutingMode: 'manual',
      defaultTicketAssigneeUserId: null,
      defaultTicketPoolUserIds: [],
    },
    status,
  })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  if (!can(access.role, 'workspace.settings')) {
    return NextResponse.json({ error: 'Owners and admins only.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}

  if (typeof body.enabled === 'boolean') {
    // Block enabling if the plan doesn't allow it.
    if (body.enabled === true) {
      const status = await getTicketingStatus(workspaceId)
      if (!status.planAllows) {
        return NextResponse.json({
          error: 'Your plan doesn\'t include ticketing. Upgrade to Scale to enable it.',
          code: 'PLAN_LOCKED',
        }, { status: 403 })
      }
    }
    data.enabled = body.enabled
  }
  if (typeof body.autoCloseAfterDays === 'number' && body.autoCloseAfterDays >= 0 && body.autoCloseAfterDays <= 365) {
    data.autoCloseAfterDays = Math.round(body.autoCloseAfterDays)
  }
  if (typeof body.autoReopenOnReply === 'boolean') data.autoReopenOnReply = body.autoReopenOnReply
  if (typeof body.fromEmail === 'string') {
    const v = body.fromEmail.trim()
    data.fromEmail = v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : null
  }
  if (typeof body.fromName === 'string')   data.fromName = body.fromName.trim().slice(0, 120) || null
  if (typeof body.signature === 'string')  data.signature = body.signature.slice(0, 2000) || null

  // Default routing for tickets that arrive without a brand (inbound
  // email, co-pilot escalations). Same canonical field names as the
  // brand editor; mapped onto the defaultTicketRouting* columns.
  if (body.ticketRoutingMode !== undefined || body.ticketAssigneeUserId !== undefined || body.ticketPoolUserIds !== undefined) {
    const routing = parseTicketRoutingBody(body, await loadRoutableMemberIds(workspaceId))
    if (!routing.ok) return NextResponse.json({ error: routing.error }, { status: 400 })
    if (routing.mode !== undefined) data.defaultTicketRoutingMode = routing.mode
    if (routing.assigneeUserId !== undefined) data.defaultTicketAssigneeUserId = routing.assigneeUserId
    if (routing.poolUserIds !== undefined) data.defaultTicketPoolUserIds = routing.poolUserIds
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const settings = await (db as any).ticketingSettings.upsert({
    where: { workspaceId },
    create: { workspaceId, ...data },
    update: data,
  })

  // Return the recomputed access status alongside the settings so the
  // client doesn't have to re-fetch via load() — that was the cause of
  // the "page keeps refreshing" symptom (load() flipped loading=true
  // and unmounted the in-flight form).
  const status = await getTicketingStatus(workspaceId)

  return NextResponse.json({ settings, status })
}
