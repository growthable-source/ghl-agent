/**
 * OAuth Callback
 * URL: /api/auth/callback
 * 
 * This is your redirect URI registered in the Marketplace.
 * It receives the authorization code and exchanges it for tokens.
 * 
 * ⚠️  No provider names in this URL path — required by Marketplace TOS.
 */

import { NextRequest, NextResponse } from 'next/server'
import { saveTokens } from '@/lib/token-store'
import type { OAuthTokenResponse } from '@/types'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  // Handle OAuth errors
  if (error) {
    console.error('[OAuth] Error from provider:', error)
    return NextResponse.redirect(
      new URL(`/dashboard?error=${encodeURIComponent(error)}`, req.url)
    )
  }

  if (!code) {
    return NextResponse.redirect(new URL('/dashboard?error=missing_code', req.url))
  }

  try {
    // Exchange authorization code for tokens
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      user_type: 'Location',
      redirect_uri: `${process.env.APP_URL}/api/auth/callback`,
    })

    const tokenRes = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!tokenRes.ok) {
      const body = await tokenRes.text()
      console.error('[OAuth] Token exchange failed:', body)
      const msg = encodeURIComponent(`token_exchange_failed: ${body}`)
      return NextResponse.redirect(new URL(`/dashboard?error=${msg}`, req.url))
    }

    const tokenData: OAuthTokenResponse = await tokenRes.json()

    // Store using locationId as key (or companyId for Agency tokens)
    const storeKey = tokenData.locationId ?? tokenData.companyId
    await saveTokens(storeKey, tokenData)

    console.log(`[OAuth] Token saved for ${tokenData.userType}: ${storeKey}`)

    // Redirect to location-specific dashboard
    const redirectUrl = new URL(`/dashboard/${storeKey}`, req.url)

    return NextResponse.redirect(redirectUrl)
  } catch (err) {
    console.error('[OAuth] Unexpected error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=unexpected', req.url))
  }
}
