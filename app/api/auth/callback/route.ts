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

    // Store using GHL locationId as key (or companyId for Agency tokens)
    const storeKey = tokenData.locationId ?? tokenData.companyId
    await saveTokens(storeKey, tokenData)

    console.log(`[OAuth] Token saved for ${tokenData.userType}: ${storeKey}`)

    // Check if a workspaceId was passed via the state param (from connect flow)
    const stateWorkspaceId = searchParams.get('state')
    let workspaceId: string | null = null

    // Upsert the GHL Location record with token data
    const locationData = {
      companyId: tokenData.companyId ?? storeKey,
      userId: tokenData.userId ?? '',
      userType: tokenData.userType ?? 'Location',
      scope: Array.isArray(tokenData.scope) ? tokenData.scope.join(' ') : (tokenData.scope ?? ''),
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      refreshTokenId: tokenData.refreshTokenId ?? '',
      expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 86400) * 1000),
      workspaceId: stateWorkspaceId || undefined,
    }

    await db.location.upsert({
      where: { id: storeKey },
      create: { id: storeKey, ...locationData },
      update: locationData,
    })

    if (stateWorkspaceId) {
      // Came from the integrations connect flow — go back to integrations
      return NextResponse.redirect(
        new URL(`/dashboard/${stateWorkspaceId}/integrations?success=crm_connected`, req.url)
      )
    }

    // No workspace context — find existing workspace for this location, or create one
    const existingLocation = await db.location.findUnique({
      where: { id: storeKey },
      select: { workspaceId: true },
    })

    if (existingLocation?.workspaceId) {
      workspaceId = existingLocation.workspaceId
    } else {
      // Create a new workspace for this GHL install
      const slug = `ws-${storeKey.slice(0, 12).toLowerCase().replace(/[^a-z0-9]/g, '')}-${Math.random().toString(36).slice(2, 8)}`
      const workspace = await db.workspace.create({
        data: {
          name: `Workspace`,
          slug,
          locations: { connect: { id: storeKey } },
        },
      })
      workspaceId = workspace.id
    }

    // New installs go to onboarding, reinstalls go to dashboard
    const agentCount = await db.agent.count({ where: { workspaceId } })
    const redirectPath = agentCount === 0
      ? `/dashboard/${workspaceId}/onboarding`
      : `/dashboard/${workspaceId}`
    return NextResponse.redirect(new URL(redirectPath, req.url))
  } catch (err) {
    console.error('[OAuth] Unexpected error:', err)
    return NextResponse.redirect(new URL('/dashboard?error=unexpected', req.url))
  }
}
