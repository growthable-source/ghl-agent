import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const locationId = searchParams.get('locationId')

  if (!locationId) {
    return NextResponse.json({ error: 'locationId required' }, { status: 400 })
  }

  const clientId = process.env.OAUTH_CLIENT_ID
  if (!clientId) {
    return NextResponse.json({ error: 'CRM OAuth not configured' }, { status: 500 })
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${process.env.APP_URL}/api/auth/crm/callback`,
    response_type: 'code',
    scope: 'contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write opportunities.readonly opportunities.write',
    state: locationId,
  })

  return NextResponse.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`)
}
