import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { exchangeAgencyCode, syncAgencyLocations } from '@/lib/leadconnector-agency'

/**
 * GET /api/auth/leadconnector-agency/callback
 * Agency-level OAuth callback for the location-control app. Upserts the
 * workspace's AgencyConnection and runs the first location sync inline
 * (agencies are typically <1k locations; well within route timeout).
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const rawState = searchParams.get('state')

  let workspaceId: string | null = null
  try {
    const decoded = JSON.parse(Buffer.from(rawState ?? '', 'base64url').toString('utf8'))
    if (decoded && typeof decoded.workspaceId === 'string') workspaceId = decoded.workspaceId
  } catch { /* handled below */ }

  const fail = (error: string) => NextResponse.redirect(
    new URL(workspaceId
      ? `/dashboard/${workspaceId}/locations?error=${encodeURIComponent(error)}`
      : `/dashboard?error=${encodeURIComponent(error)}`, req.url),
  )

  if (!workspaceId) return fail('missing_state')
  if (searchParams.get('error')) return fail(searchParams.get('error')!)
  if (!code) return fail('missing_code')

  try {
    const t = await exchangeAgencyCode(code)
    if (!t.companyId) return fail('no_company_in_grant')

    const session = await auth()
    const conn = await db.agencyConnection.upsert({
      where: { workspaceId_companyId: { workspaceId, companyId: t.companyId } },
      create: {
        workspaceId,
        companyId: t.companyId,
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope ?? ''),
        connectedByUserId: session?.user?.id ?? null,
      },
      update: {
        accessToken: t.access_token,
        refreshToken: t.refresh_token,
        expiresAt: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
        scope: Array.isArray(t.scope) ? t.scope.join(' ') : (t.scope ?? ''),
        tokenRefreshFailedAt: null,
      },
    })

    // First sync inline; failure is non-fatal (Refresh button retries).
    await syncAgencyLocations(conn.id).catch(err =>
      console.warn('[AgencyOAuth] initial location sync failed:', err?.message))

    return NextResponse.redirect(
      new URL(`/dashboard/${workspaceId}/locations?connected=1`, req.url),
    )
  } catch (err: any) {
    console.error('[AgencyOAuth] callback error:', err?.message)
    return fail('token_exchange_failed')
  }
}
