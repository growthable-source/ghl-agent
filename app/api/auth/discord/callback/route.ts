import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/discord/callback
 *
 * Discord's webhook.incoming flow returns:
 *   webhook: { id, token, url, channel_id, name, guild_id }
 *   guild:   { id, name, icon }   (shallow)
 *
 * We only need `webhook.url` to post notifications, but we stash guild +
 * channel metadata so the integrations UI can show something meaningful
 * ("Voxility · #alerts") instead of an opaque URL.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const workspaceId = searchParams.get('state')
  const error = searchParams.get('error')

  function back(qs: string) {
    return NextResponse.redirect(new URL(
      `/dashboard/${workspaceId || ''}/settings/integrations?${qs}`,
      req.url,
    ))
  }

  if (error) return back(`error=${encodeURIComponent(`discord:${error}`)}`)
  if (!code || !workspaceId) return back('error=discord:missing_code_or_state')

  const clientId = process.env.DISCORD_CLIENT_ID
  const clientSecret = process.env.DISCORD_CLIENT_SECRET
  if (!clientId || !clientSecret) return back('error=discord:not_configured')

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${appUrl}/api/auth/discord/callback`,
    }),
  })
  if (!tokenRes.ok) {
    const body = await tokenRes.text().catch(() => '')
    console.error('[Discord OAuth] token exchange failed:', body)
    return back('error=discord:token_exchange_failed')
  }
  const data = await tokenRes.json() as {
    webhook?: { id: string; token: string; url: string; channel_id: string; name: string; guild_id: string }
    guild?: { id: string; name: string; icon?: string | null }
  }

  if (!data.webhook?.url) return back('error=discord:no_webhook')

  await db.notificationChannel.create({
    data: {
      workspaceId,
      type: 'discord',
      isActive: true,
      events: [],
      config: {
        webhookUrl: data.webhook.url,
        webhookName: data.webhook.name,
        channelId: data.webhook.channel_id,
        guildId: data.guild?.id ?? data.webhook.guild_id,
        guildName: data.guild?.name ?? null,
        guildIcon: data.guild?.icon ?? null,
      },
    },
  })

  return back('connected=discord')
}
