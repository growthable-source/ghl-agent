import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * GET /api/auth/slack/callback
 *
 * Handles the Slack OAuth response. Slack returns (amongst other things):
 *   incoming_webhook: { url, channel, channel_id, configuration_url }
 *   team:             { id, name }
 *
 * We persist the whole shape as a NotificationChannel of type 'slack' so
 * the existing notify() dispatcher keeps working unchanged — it only
 * reads config.webhookUrl, everything else is displayed in the UI.
 *
 * User rejections and error codes funnel back to the integrations page
 * so the user sees the failure in context rather than a raw 500.
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

  if (error) return back(`error=${encodeURIComponent(`slack:${error}`)}`)
  if (!code || !workspaceId) return back('error=slack:missing_code_or_state')

  const clientId = process.env.SLACK_CLIENT_ID
  const clientSecret = process.env.SLACK_CLIENT_SECRET
  if (!clientId || !clientSecret) return back('error=slack:not_configured')

  const appUrl = (process.env.APP_URL || new URL(req.url).origin).replace(/\/$/, '')

  // Exchange the code. Slack's oauth.v2.access is form-encoded.
  const tokenRes = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: `${appUrl}/api/auth/slack/callback`,
    }),
  })
  const data = await tokenRes.json() as {
    ok: boolean
    error?: string
    incoming_webhook?: { url: string; channel: string; channel_id: string; configuration_url: string }
    team?: { id: string; name: string }
  }
  if (!data.ok) return back(`error=slack:${encodeURIComponent(data.error || 'token_exchange_failed')}`)
  if (!data.incoming_webhook?.url) return back('error=slack:no_webhook')

  // Store as a notification channel. Everything Slack gave us beyond the
  // URL (team name, channel name, config edit link) lives in config so the
  // UI can render it without a second round-trip.
  await db.notificationChannel.create({
    data: {
      workspaceId,
      type: 'slack',
      isActive: true,
      events: [],
      config: {
        webhookUrl: data.incoming_webhook.url,
        channel: data.incoming_webhook.channel,
        channelId: data.incoming_webhook.channel_id,
        configurationUrl: data.incoming_webhook.configuration_url,
        teamId: data.team?.id,
        teamName: data.team?.name,
      },
    },
  })

  return back('connected=slack')
}
