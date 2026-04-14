import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const workspaceId = searchParams.get('state')

  if (!code || !workspaceId) return NextResponse.redirect(new URL('/dashboard', req.url))

  const clientId = process.env.HUBSPOT_CLIENT_ID
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(new URL(`/dashboard/${workspaceId}/integrations?error=hubspot_not_configured`, req.url))
  }

  const tokenRes = await fetch('https://api.hubapi.com/oauth/v1/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${process.env.APP_URL}/api/auth/hubspot/callback`,
      code,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL(`/dashboard/${workspaceId}/integrations?error=hubspot_auth_failed`, req.url))
  }

  const tokens = await tokenRes.json()

  // Find the first location in this workspace to store the integration
  const location = await db.location.findFirst({
    where: { workspaceId },
    select: { id: true },
  })
  const locationId = location?.id ?? workspaceId

  const existing = await db.integration.findFirst({ where: { locationId, type: 'hubspot' } })

  await db.integration.upsert({
    where: { id: existing?.id || 'new-hubspot' },
    create: {
      locationId,
      type: 'hubspot',
      name: 'HubSpot',
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      isActive: true,
    },
    update: {
      credentials: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      isActive: true,
    },
  })

  return NextResponse.redirect(new URL(`/dashboard/${workspaceId}/integrations`, req.url))
}
