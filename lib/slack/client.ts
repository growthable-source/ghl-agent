/**
 * Minimal Slack Web API client (fetch-based). We only need a handful of
 * methods, so we avoid the heavy @slack/web-api dependency.
 */

const SLACK_API = 'https://slack.com/api'

async function slackPost<T = Record<string, unknown>>(
  method: string,
  token: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>
  if (!json.ok) throw new Error(`slack ${method} failed: ${json.error ?? res.status}`)
  return json as T
}

export async function exchangeOAuthCode(args: {
  code: string
  clientId: string
  clientSecret: string
  redirectUri: string
}) {
  const params = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    client_secret: args.clientSecret,
    redirect_uri: args.redirectUri,
  })
  const res = await fetch(`${SLACK_API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  })
  const json = (await res.json()) as {
    ok: boolean
    error?: string
    access_token?: string
    bot_user_id?: string
    app_id?: string
    scope?: string
    team?: { id?: string; name?: string }
    authed_user?: { id?: string }
  }
  if (!json.ok) throw new Error(`slack oauth.v2.access failed: ${json.error}`)
  return {
    botToken: json.access_token as string,
    botUserId: json.bot_user_id as string,
    appId: json.app_id,
    scopes: json.scope,
    teamId: json.team?.id as string,
    teamName: json.team?.name,
    installedByUserId: json.authed_user?.id,
  }
}

export async function postMessage(
  token: string,
  args: { channel: string; text: string; thread_ts?: string; blocks?: unknown[] },
) {
  const json = await slackPost<{ ts: string; channel: string }>('chat.postMessage', token, args)
  return { ts: json.ts, channel: json.channel }
}

export async function listChannels(token: string) {
  const json = await slackPost<{
    channels: Array<{ id: string; name: string; is_member: boolean }>
  }>('conversations.list', token, {
    types: 'public_channel,private_channel',
    exclude_archived: true,
    limit: 1000,
  })
  return json.channels.map((c) => ({ id: c.id, name: c.name, isMember: c.is_member }))
}

export async function getUserInfo(token: string, userId: string) {
  const json = await slackPost<{
    user: { id: string; real_name?: string; profile?: { email?: string; display_name?: string } }
  }>('users.info', token, { user: userId })
  const u = json.user
  return {
    id: u.id,
    email: u.profile?.email,
    displayName: u.profile?.display_name || u.real_name || u.id,
  }
}
