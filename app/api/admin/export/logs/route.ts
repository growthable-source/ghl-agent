import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getAdminSession, logAdminAction } from '@/lib/admin-auth'
import { toCsv, csvResponse, ADMIN_EXPORT_ROW_CAP } from '@/lib/admin-csv'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const session = await getAdminSession()
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const sp = req.nextUrl.searchParams
  const status = (sp.get('status') ?? '').trim()
  const locationId = (sp.get('locationId') ?? '').trim()
  const agentId = (sp.get('agentId') ?? '').trim()
  const contactId = (sp.get('contactId') ?? '').trim()

  const where: any = {}
  if (status) where.status = status
  if (locationId) where.locationId = locationId
  if (agentId) where.agentId = agentId
  if (contactId) where.contactId = contactId

  const logs = await db.messageLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: ADMIN_EXPORT_ROW_CAP,
    select: {
      id: true, locationId: true, agentId: true, contactId: true, conversationId: true,
      status: true, inboundMessage: true, outboundReply: true,
      actionsPerformed: true, tokensUsed: true, errorMessage: true,
      needsApproval: true, approvalStatus: true, approvalReason: true,
      createdAt: true,
    },
  })

  const rows: Array<Array<string | number | null>> = [[
    'id', 'locationId', 'agentId', 'contactId', 'conversationId',
    'status', 'inboundMessage', 'outboundReply',
    'actionsPerformed', 'tokensUsed', 'errorMessage',
    'needsApproval', 'approvalStatus', 'approvalReason',
    'createdAt',
  ]]
  for (const l of logs) {
    rows.push([
      l.id, l.locationId, l.agentId ?? '', l.contactId, l.conversationId ?? '',
      l.status,
      l.inboundMessage ?? '', l.outboundReply ?? '',
      l.actionsPerformed.join('|'),
      l.tokensUsed ?? '', l.errorMessage ?? '',
      l.needsApproval ? 'true' : 'false',
      l.approvalStatus ?? '', l.approvalReason ?? '',
      l.createdAt.toISOString(),
    ])
  }

  logAdminAction({
    admin: session,
    action: 'export_logs_csv',
    meta: { status, locationId, agentId, contactId, rowCount: logs.length },
  }).catch(() => {})

  const stamp = new Date().toISOString().slice(0, 10)
  return csvResponse(`voxility-logs-${stamp}.csv`, toCsv(rows))
}
