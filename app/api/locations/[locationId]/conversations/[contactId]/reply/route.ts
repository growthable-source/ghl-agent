import { NextRequest, NextResponse } from 'next/server'
import { sendMessage } from '@/lib/crm-client'

type Params = { params: Promise<{ locationId: string; contactId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { locationId, contactId } = await params
  const body = await req.json()
  const { message } = body
  if (!message) return NextResponse.json({ error: 'message required' }, { status: 400 })

  const result = await sendMessage(locationId, {
    type: 'SMS',
    contactId,
    message,
  })

  return NextResponse.json({ success: true, ...result })
}
