import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

/**
 * GET /api/auth/discord/connect?workspaceId=<id>
 *
 * Starts Discord's OAuth2 flow using the `webhook.incoming` scope. When
 * the user approves, Discord walks them through a server+channel picker
 * and returns a webhook URL bound to that channel. No bot, no permissions
 * beyond posting via the webhook — minimum surface for our current
 * handover-paging use case.
 *
 * Voxility owns the Discord app (DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const workspaceId = searchParams.get('workspaceId')
  if (!workspaceId) return NextResponse.json({ error: 'workspaceId required' }, { status: 400 })

  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const clientId = process.env.DISCORD_CLIENT_ID
  if (!clientId) {
    return NextResponse.redirect(new URL(
      `/dashboard/${workspaceId}/settings/integrations?error=discord_not_configured`,
      req.url,
    ))
  }

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: 'webhook.incoming',
    redirect_uri: `${appUrl}/api/auth/discord/callback`,
    state: workspaceId,
  })

  return NextResponse.redirect(`https://discord.com/oauth2/authorize?${params}`)
}
