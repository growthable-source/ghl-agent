import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')

  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }

  // Optional: callers (e.g. the agent-creation wizard) can pass
  // returnTo to be sent back to a specific page after OAuth instead
  // of the default /integrations landing. Whitelist to internal
  // paths only — never honour an arbitrary URL as a redirect target.
  const rawReturnTo = searchParams.get('returnTo')
  const returnTo =
    rawReturnTo && rawReturnTo.startsWith('/dashboard/') && !rawReturnTo.startsWith('//')
      ? rawReturnTo
      : null

  // Optional: agentId makes this a PER-AGENT connection — the callback
  // binds the freshly connected sub-account to this agent's locationId.
  // Connections belong to agents, not the workspace; this is how the
  // agent CRM card (text + voice agents) starts the flow. Validated
  // against the workspace so a foreign agent id can't be smuggled in.
  const rawAgentId = searchParams.get('agentId')
  let agentId: string | null = null
  if (rawAgentId) {
    const agent = await db.agent.findFirst({
      where: { id: rawAgentId, workspaceId },
      select: { id: true },
    })
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found in workspace' }, { status: 404 })
    }
    agentId = agent.id
  }

  const clientId = process.env.OAUTH_CLIENT_ID
  const versionId = process.env.OAUTH_VERSION_ID
  if (!clientId) {
    return NextResponse.json({ error: 'CRM OAuth not configured' }, { status: 500 })
  }

  // state encoding: when returnTo or agentId is present, encode
  // {workspaceId, agentId?, returnTo?} as base64url JSON. Otherwise stay
  // with bare workspaceId so unrelated flows that don't know about this
  // contract still work.
  const state = returnTo || agentId
    ? Buffer.from(
        JSON.stringify({ workspaceId, ...(agentId ? { agentId } : {}), ...(returnTo ? { returnTo } : {}) }),
        'utf8',
      ).toString('base64url')
    : workspaceId

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
    //   users.readonly               → fetch assigned-user details
    //                                  (powers {{user.*}} merge fields)
    //   locations.readonly           → fetch the sub-account's name,
    //                                  address, phone, email, website
    //                                  at install time (lead snapshot
    //                                  for the admin install registry)
    // We were missing the /events.* pair — bookings returned 401 silently.
    scope: 'contacts.readonly contacts.write conversations.readonly conversations.write conversations/message.readonly conversations/message.write opportunities.readonly opportunities.write calendars.readonly calendars.write calendars/events.readonly calendars/events.write locations.readonly locations/customFields.readonly locations/customFields.write locations/tags.readonly locations/tags.write users.readonly workflows.readonly',
    state,
  })

  if (versionId) params.set('version_id', versionId)

  return NextResponse.redirect(`https://marketplace.gohighlevel.com/oauth/chooselocation?${params}`)
}
