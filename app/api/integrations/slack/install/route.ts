import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

// Bot scopes the Slack app requests. Mirror these in slack/manifest.yaml.
const SCOPES = [
  'chat:write',
  'channels:read',
  'channels:history',
  'groups:history',
  'team:read',
  'users:read',
  'users:read.email',
].join(',')

/**
 * Start the Slack OAuth install for a workspace. Redirects the operator to
 * Slack's authorize screen; Slack calls back to /api/integrations/slack/callback.
 * The workspace id rides along in `state` and is re-checked on callback.
 */
export async function GET(req: NextRequest) {
  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })
  }
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const clientId = process.env.SLACK_CLIENT_ID
  if (!clientId) return NextResponse.json({ error: 'Slack not configured' }, { status: 500 })

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/integrations/slack/callback`
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', workspaceId)
  return NextResponse.redirect(url.toString())
}
