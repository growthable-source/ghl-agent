import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendMessage } from '@/lib/crm-client'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; contactId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, contactId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access
  const body = await req.json()
  const { message } = body
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  // Get the first location for this workspace to use as the CRM locationId
  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  if (!location) return NextResponse.json({ error: 'No location found for workspace' }, { status: 404 })

  const result = await sendMessage(location.id, {
    type: 'SMS',
    contactId,
    message,
  })

  return NextResponse.json({ success: true, ...result })
}
