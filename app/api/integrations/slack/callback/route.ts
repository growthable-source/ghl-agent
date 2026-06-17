import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { exchangeOAuthCode } from '@/lib/slack/client'
import { upsertSlackConnection } from '@/lib/slack/connection'

/**
 * Slack OAuth callback. Exchanges the code for a bot token and persists the
 * (encrypted) install against the workspace carried in `state`. We re-verify
 * the caller is a member of that workspace before storing anything.
 */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const workspaceId = req.nextUrl.searchParams.get('state')
  const oauthError = req.nextUrl.searchParams.get('error')

  if (oauthError) {
    return NextResponse.redirect(
      `${req.nextUrl.origin}/dashboard/${workspaceId ?? ''}/integrations/slack?error=${encodeURIComponent(oauthError)}`,
    )
  }
  if (!code || !workspaceId) {
    return NextResponse.json({ error: 'missing code/state' }, { status: 400 })
  }

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: 'Slack not configured' }, { status: 500 })
  }

  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin}/api/integrations/slack/callback`
  try {
    const inst = await exchangeOAuthCode({ code, clientId, clientSecret, redirectUri })
    await upsertSlackConnection({
      workspaceId,
      teamId: inst.teamId,
      teamName: inst.teamName,
      botToken: inst.botToken,
      botUserId: inst.botUserId,
      appId: inst.appId,
      scopes: inst.scopes,
      installedByUserId: access.session.user.id,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'install failed'
    return NextResponse.redirect(
      `${req.nextUrl.origin}/dashboard/${workspaceId}/integrations/slack?error=${encodeURIComponent(message)}`,
    )
  }

  return NextResponse.redirect(`${req.nextUrl.origin}/dashboard/${workspaceId}/integrations/slack?connected=1`)
}
