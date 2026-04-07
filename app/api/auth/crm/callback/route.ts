import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state') // locationId
  const error = searchParams.get('error')

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL(`/dashboard/${state || ''}/integrations?error=ghl_auth_failed`, req.url)
    )
  }

  try {
    const params = new URLSearchParams({
      client_id: process.env.OAUTH_CLIENT_ID!,
      client_secret: process.env.OAUTH_CLIENT_SECRET!,
      grant_type: 'authorization_code',
      code,
      user_type: 'Location',
      redirect_uri: `${process.env.APP_URL}/api/auth/crm/callback`,
    })

    const tokenRes = await fetch('https://services.leadconnectorhq.com/oauth/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })

    if (!tokenRes.ok) {
      console.error('[CRM Connect] Token exchange failed:', await tokenRes.text())
      return NextResponse.redirect(
        new URL(`/dashboard/${state}/integrations?error=ghl_token_failed`, req.url)
      )
    }

    const tokenData = await tokenRes.json()

    // Update the existing workspace Location with real GHL tokens
    await db.location.update({
      where: { id: state },
      data: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        refreshTokenId: tokenData.refresh_token_id || '',
        expiresAt: new Date(Date.now() + (tokenData.expires_in || 86400) * 1000),
        companyId: tokenData.companyId || state,
        userId: tokenData.userId || '',
        userType: tokenData.userType || 'Location',
        scope: tokenData.scope || '',
      },
    })

    console.log(`[CRM Connect] Tokens saved for workspace ${state}`)

    return NextResponse.redirect(
      new URL(`/dashboard/${state}/integrations?success=ghl_connected`, req.url)
    )
  } catch (err) {
    console.error('[CRM Connect] Error:', err)
    return NextResponse.redirect(
      new URL(`/dashboard/${state}/integrations?error=ghl_unexpected`, req.url)
    )
  }
}
