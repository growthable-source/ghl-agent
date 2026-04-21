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
    // Per GHL OpenAPI spec, each endpoint requires its matching scope:
    //   calendars.readonly           → list calendars, read free-slots
    //   calendars.write              → create/update/delete calendars
    //   calendars/events.readonly    → read appointments, get notes
    //   calendars/events.write       → CREATE APPOINTMENTS, edit, create notes
    //   workflows.readonly           → list workflows for the picker;
    //                                  enroll/remove already work without it
    //   locations/tags.readonly      → list tags for the trigger-tag picker
    //   locations/tags.write         → create new tags from the picker
    // We were missing the /events.* pair — bookings returned 401 silently.
    scope: 'contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write opportunities.readonly opportunities.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write locations/customFields.readonly locations/customFields.write locations/tags.readonly locations/tags.write workflows.readonly',
    state: workspaceId,
  })

  if (versionId) params.set('version_id', versionId)

  return NextResponse.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`)
}
