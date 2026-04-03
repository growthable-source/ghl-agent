import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const locationId = searchParams.get('locationId')

  if (!locationId) return NextResponse.json({ error: 'locationId required' }, { status: 400 })

  const clientId = process.env.HUBSPOT_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'HUBSPOT_CLIENT_ID not set' }, { status: 500 })

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.APP_URL}/api/auth/hubspot/callback`,
    scope: 'crm.objects.contacts.read crm.objects.contacts.write crm.objects.deals.read crm.objects.deals.write',
    state: locationId,
  })

  return NextResponse.redirect(`https://app.hubspot.com/oauth/authorize?${params}`)
}
