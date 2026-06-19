/**
 * Google content OAuth callback. Verifies the signed state, exchanges the
 * code for a refresh token, and upserts the workspace's
 * GoogleContentConnection. Redirects back to the knowledge area with a status
 * flag. Dormant until GOOGLE_CONTENT_ENABLED=true.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { exchangeCode, isGoogleContentEnabled, verifyOAuthState } from '@/lib/google/content-oauth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isGoogleContentEnabled()) {
    return NextResponse.json({ error: 'Google content connector is not enabled' }, { status: 404 })
  }

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const oauthError = url.searchParams.get('error')

  if (oauthError) return redirectBack(req, undefined, `error:${oauthError}`)
  if (!code || !state) return redirectBack(req, undefined, 'error:missing_code_or_state')

  const verified = verifyOAuthState(state)
  if (!verified.ok) return redirectBack(req, undefined, `error:invalid_state:${verified.reason}`)
  const { workspaceId } = verified

  try {
    const redirectUri = new URL('/api/integrations/google-content/callback', baseUrl(req)).toString()
    const tokens = await exchangeCode({ code, redirectUri })

    await db.googleContentConnection.upsert({
      where: { workspaceId },
      create: {
        workspaceId,
        email: tokens.email ?? null,
        refreshToken: tokens.refreshToken,
        scopes: tokens.scopes,
        isActive: true,
      },
      update: {
        email: tokens.email ?? null,
        refreshToken: tokens.refreshToken,
        scopes: tokens.scopes,
        isActive: true,
      },
    })

    return redirectBack(req, workspaceId, 'connected')
  } catch (err) {
    return redirectBack(req, workspaceId, `error:${err instanceof Error ? err.message : 'exchange_failed'}`)
  }
}

function baseUrl(req: NextRequest): string {
  return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || new URL(req.url).origin
}

function redirectBack(req: NextRequest, workspaceId: string | undefined, status: string): NextResponse {
  const dest = workspaceId
    ? new URL(`/dashboard/${workspaceId}/knowledge`, baseUrl(req))
    : new URL('/dashboard', baseUrl(req))
  dest.searchParams.set('google_content', status)
  return NextResponse.redirect(dest.toString())
}
