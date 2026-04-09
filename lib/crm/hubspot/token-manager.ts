/**
 * HubSpot Token Manager
 * Retrieves and auto-refreshes HubSpot OAuth tokens stored in the Integration model.
 */

import { db } from '@/lib/db'

interface HubSpotCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
}

export async function getHubSpotAccessToken(locationId: string): Promise<string | null> {
  const integration = await db.integration.findFirst({
    where: { locationId, type: 'hubspot', isActive: true },
  })
  if (!integration) return null

  const creds = integration.credentials as unknown as HubSpotCredentials
  if (!creds?.accessToken) return null

  // Token still valid (with 5-minute buffer)
  if (Date.now() < creds.expiresAt - 300_000) {
    return creds.accessToken
  }

  // Refresh the token
  return refreshHubSpotToken(integration.id, creds.refreshToken)
}

async function refreshHubSpotToken(integrationId: string, refreshToken: string): Promise<string | null> {
  const clientId = process.env.HUBSPOT_CLIENT_ID
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('[HubSpot] Missing HUBSPOT_CLIENT_ID or HUBSPOT_CLIENT_SECRET')
    return null
  }

  try {
    const res = await fetch('https://api.hubapi.com/oauth/v1/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) {
      console.error('[HubSpot] Token refresh failed:', await res.text())
      return null
    }

    const data = await res.json()

    // Update stored credentials
    await db.integration.update({
      where: { id: integrationId },
      data: {
        credentials: {
          accessToken: data.access_token,
          refreshToken: data.refresh_token,
          expiresAt: Date.now() + data.expires_in * 1000,
        },
      },
    })

    return data.access_token
  } catch (err) {
    console.error('[HubSpot] Token refresh error:', err)
    return null
  }
}
