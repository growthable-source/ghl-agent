import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  const clientId = process.env.OAUTH_CLIENT_ID
  const versionId = process.env.OAUTH_VERSION_ID
  if (!clientId) {
    return NextResponse.json({ error: 'CRM OAuth not configured' }, { status: 500 })
  }

  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    client_id: clientId,
    scope: 'contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write opportunities.readonly opportunities.write calendars.write calendars.readonly locations/customFields.readonly locations/customFields.write',
    state: workspaceId,
  })

  if (versionId) params.set('version_id', versionId)

  return NextResponse.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`)
}
