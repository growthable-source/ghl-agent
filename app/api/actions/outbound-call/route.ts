import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { initiateOutboundCall } from '@/lib/outbound-call'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { locationId, contactId, phone, first_name, last_name, agentId } = body

    if (!locationId) {
      return NextResponse.json({ error: 'locationId is required' }, { status: 400 })
    }

    // Validate location exists (proves app is installed)
    const location = await db.location.findUnique({ where: { id: locationId } })
    if (!location) {
      return NextResponse.json({ error: 'Location not found' }, { status: 401 })
    }

    // Resolve phone number
    let contactPhone = phone
    let resolvedContactId = contactId

    if (!contactPhone && contactId) {
      // Fetch contact from CRM to get phone
      try {
        const { getContact } = await import('@/lib/crm-client')
        const contact = await getContact(locationId, contactId)
        contactPhone = contact?.phone
        if (!contactPhone) {
          return NextResponse.json({ error: 'Contact has no phone number' }, { status: 400 })
        }
      } catch {
        return NextResponse.json({ error: 'Could not retrieve contact phone number' }, { status: 400 })
      }
    }

    if (!contactPhone) {
      return NextResponse.json({ error: 'No phone number provided or found for contact' }, { status: 400 })
    }

    const contactName = [first_name, last_name].filter(Boolean).join(' ') || undefined

    const result = await initiateOutboundCall({
      locationId,
      agentId: agentId || undefined,
      contactId: resolvedContactId || '',
      contactPhone,
      contactName,
      triggerSource: 'ghl_workflow',
    })

    return NextResponse.json({ success: true, callLogId: result.callLogId, vapiCallId: result.vapiCallId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    console.error('[OutboundCall Action]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
