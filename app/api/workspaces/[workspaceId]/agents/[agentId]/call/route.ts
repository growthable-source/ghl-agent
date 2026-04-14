import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { initiateOutboundCall } from '@/lib/outbound-call'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string; agentId: string }> }
) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const { contactId, contactPhone, contactName } = body

  if (!contactPhone) {
    return NextResponse.json({ error: 'contactPhone is required' }, { status: 400 })
  }

  // Verify agent belongs to workspace
  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true, locationId: true },
  })
  if (!agent) {
    return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  }

  try {
    const result = await initiateOutboundCall({
      locationId: agent.locationId,
      agentId,
      contactId: contactId || '',
      contactPhone,
      contactName,
      triggerSource: 'manual',
    })

    return NextResponse.json({ success: true, callLogId: result.callLogId, vapiCallId: result.vapiCallId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
