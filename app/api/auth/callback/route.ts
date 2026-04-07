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
import { db } from '@/lib/db'
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

    // If state param is a workspace ID (from connect flow), link GHL location to that workspace
    const workspaceId = searchParams.get('state')
    if (workspaceId && workspaceId.startsWith('ws_') && workspaceId !== storeKey) {
      // Move agents and user links from the temp workspace to the real GHL location
      try {
        // Link users from the temp workspace to the real location
        const userLinks = await db.userLocation.findMany({ where: { locationId: workspaceId } })
        for (const link of userLinks) {
          await db.userLocation.upsert({
            where: { userId_locationId: { userId: link.userId, locationId: storeKey } },
            create: { userId: link.userId, locationId: storeKey, role: link.role },
            update: {},
          })
        }
        // Clean up temp workspace
        await db.userLocation.deleteMany({ where: { locationId: workspaceId } })
        await db.location.delete({ where: { id: workspaceId } }).catch(() => {})
      } catch (err) {
        console.error('[OAuth] Error linking workspace:', err)
      }
      return NextResponse.redirect(new URL(`/dashboard/${storeKey}/integrations?success=crm_connected`, req.url))
    }

    // New installs go to onboarding, reinstalls go to dashboard
    const agentCount = await db.agent.count({ where: { locationId: storeKey } })
    const redirectPath = agentCount === 0
      ? `/dashboard/${storeKey}/onboarding`
      : `/dashboard/${storeKey}`
    return NextResponse.redirect(new URL(redirectPath, req.url))
  } catch (err) {
    console.error('[OAuth] Unexpected error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=unexpected', req.url))
  }
}
