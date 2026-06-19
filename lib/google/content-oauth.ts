/**
 * Google content connector — OAuth + token helpers (Drive now, Gmail later).
 *
 * Reuses the app's existing Google OAuth client (GOOGLE_CLIENT_ID/SECRET) but
 * is a SEPARATE consent round-trip from NextAuth login: it adds the
 * non-restricted `drive.file` scope and stores its own refresh token on a
 * workspace-scoped GoogleContentConnection.
 *
 * The whole feature is dormant until GOOGLE_CONTENT_ENABLED=true and the
 * Drive API + Picker key are provisioned on the existing Google Cloud project.
 * isGoogleContentEnabled() gates every entry point so nothing surfaces or runs
 * before then.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

// drive.file: per-file access granted only through the Google Picker — the app
// never sees the whole drive, so no restricted-scope verification is needed.
// userinfo.email lets the callback record which account connected.
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
export const EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email'

// Gmail is a RESTRICTED scope (verification + CASA assessment). Defined here
// for the future flag, but never requested until that milestone lands.
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export function googleContentScopes(): string {
  return [DRIVE_SCOPE, EMAIL_SCOPE].join(' ')
}

/** Master kill-switch — the connector is invisible/inert until this is on. */
export function isGoogleContentEnabled(): boolean {
  return process.env.GOOGLE_CONTENT_ENABLED === 'true'
}

function clientCreds(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) return null
  return { clientId, clientSecret }
}

function stateSecret(): string | null {
  return process.env.GOOGLE_OAUTH_STATE_SECRET ?? process.env.META_OAUTH_STATE_SECRET ?? null
}

const STATE_MAX_AGE_MS = 10 * 60 * 1000

export function signOAuthState(workspaceId: string): string | null {
  const secret = stateSecret()
  if (!secret) return null
  const payload = Buffer.from(
    JSON.stringify({ workspaceId, nonce: randomBytes(16).toString('hex'), ts: Date.now(), kind: 'google_content' }),
  ).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload).digest('hex')
  return `${payload}.${sig}`
}

export function verifyOAuthState(state: string):
  | { ok: true; workspaceId: string }
  | { ok: false; reason: string } {
  const secret = stateSecret()
  if (!secret) return { ok: false, reason: 'no_state_secret' }
  const [payload, sig] = state.split('.')
  if (!payload || !sig) return { ok: false, reason: 'malformed' }
  const expected = createHmac('sha256', secret).update(payload).digest('hex')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
      workspaceId?: string; ts?: number; kind?: string
    }
    if (decoded.kind !== 'google_content') return { ok: false, reason: 'wrong_kind' }
    if (!decoded.workspaceId) return { ok: false, reason: 'no_workspace' }
    if (!decoded.ts || Date.now() - decoded.ts > STATE_MAX_AGE_MS) return { ok: false, reason: 'expired' }
    return { ok: true, workspaceId: decoded.workspaceId }
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
}

export function buildAuthUrl(opts: { workspaceId: string; redirectUri: string }): string | null {
  const creds = clientCreds()
  const state = signOAuthState(opts.workspaceId)
  if (!creds || !state) return null
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', creds.clientId)
  authUrl.searchParams.set('redirect_uri', opts.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', googleContentScopes())
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('include_granted_scopes', 'true')
  return authUrl.toString()
}

export interface TokenExchangeResult {
  refreshToken: string
  accessToken: string
  scopes: string
  email?: string
}

/** Exchange an auth code for tokens; resolves the connected account email. */
export async function exchangeCode(opts: { code: string; redirectUri: string }): Promise<TokenExchangeResult> {
  const creds = clientCreds()
  if (!creds) throw new Error('GOOGLE_CLIENT_ID/SECRET missing')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: opts.code,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: opts.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string; refresh_token?: string; scope?: string; error?: string; error_description?: string
  }
  if (!res.ok || !json.access_token) {
    throw new Error(`token_exchange_failed: ${json.error_description ?? json.error ?? res.status}`)
  }
  if (!json.refresh_token) throw new Error('no_refresh_token_returned — reconnect with prompt=consent')

  const email = await fetchEmail(json.access_token).catch(() => undefined)
  return { refreshToken: json.refresh_token, accessToken: json.access_token, scopes: json.scope ?? '', email }
}

/** Mint a short-lived access token from a stored refresh token. */
export async function refreshAccessToken(refreshToken: string): Promise<{ accessToken: string; expiresIn: number }> {
  const creds = clientCreds()
  if (!creds) throw new Error('GOOGLE_CLIENT_ID/SECRET missing')
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: 'refresh_token',
    }),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string }
  if (!res.ok || !json.access_token) throw new Error(`refresh_failed: ${json.error ?? res.status}`)
  return { accessToken: json.access_token, expiresIn: json.expires_in ?? 3600 }
}

async function fetchEmail(accessToken: string): Promise<string | undefined> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) return undefined
  const json = (await res.json().catch(() => ({}))) as { email?: string }
  return json.email
}
