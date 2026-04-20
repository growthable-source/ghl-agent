import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/auth/slack/connect?workspaceId=<id>
 *
 * Starts the Slack OAuth flow. We ask only for the `incoming-webhook`
 * scope so Slack's own channel picker runs during install — the user
 * chooses which channel Voxility posts to, and the callback receives a
 * ready-to-use webhook URL bound to that channel.
 *
 * Voxility owns the Slack app (SLACK_CLIENT_ID / SLACK_CLIENT_SECRET).
 * Every customer installs it into their own workspace; we store the
 * webhook + channel metadata per Voxility workspace.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(new URL(`/dashboard/${workspaceId}/settings/integrations?error=slack_not_configured`, req.url))
  }

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')
  const params = new URLSearchParams({
    client_id: clientId,
    // `incoming-webhook` is the bot-level scope for webhook creation.
    // Slack adds channel-picker UX to the install screen for this scope.
    scope: 'incoming-webhook',
    redirect_uri: `${appUrl}/api/auth/slack/callback`,
    // CSRF-light: workspaceId travels as state so callback knows where
    // to attach the new channel without relying on session lookups.
    state: workspaceId,
  })

  return NextResponse.redirect(`https://slack.com/oauth/v2/authorize?${params}`)
}
