/**
 * Per-agency portal-URL binding for the embedded GHL landing page.
 *
 * Both methods authenticate with the encrypted SSO blob itself — the
 * caller is an anonymous iframe visitor, not a dashboard user, so there
 * is no NextAuth session to lean on. Decrypting with the marketplace
 * Shared Secret proves the request originated from a real GHL session
 * (same trust model as /api/auth/leadconnector-iframe-handshake).
 *
 *   POST { encryptedData }            → { portalUrl: string | null }
 *   PUT  { encryptedData, portalUrl } → { portalUrl }  (validated + upserted)
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decryptSsoBlobAnyKey, ssoSharedSecrets } from '@/lib/leadconnector-sso'
import { normalizePortalEmbedUrl } from '@/lib/portal-embed-url'

export const dynamic = 'force-dynamic'

async function resolveCompanyId(req: NextRequest): Promise<
  | { ok: true; companyId: string; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  // Accept any configured Shared Secret — the portal-wrapper marketplace
  // app has its own key, separate from the dashboard app's.
  if (ssoSharedSecrets().length === 0) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'LEADCONNECTOR_SSO_KEY is not configured on this deployment.', code: 'SSO_NOT_CONFIGURED' },
        { status: 503 },
      ),
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  }
  const encryptedData = body?.encryptedData
  if (!encryptedData || typeof encryptedData !== 'string') {
    return { ok: false, response: NextResponse.json({ error: 'Missing encryptedData' }, { status: 400 }) }
  }

  try {
    const payload = decryptSsoBlobAnyKey(encryptedData)
    if (!payload.companyId || typeof payload.companyId !== 'string') {
      return {
        ok: false,
        response: NextResponse.json({ error: 'SSO payload has no companyId', code: 'NO_COMPANY' }, { status: 401 }),
      }
    }
    return { ok: true, companyId: payload.companyId, body }
  } catch (err) {
    console.error('[Embedded portal-binding] Decrypt failed:', err instanceof Error ? err.message : err)
    return {
      ok: false,
      response: NextResponse.json({ error: 'Could not verify your CRM identity.', code: 'DECRYPT_FAILED' }, { status: 401 }),
    }
  }
}

export async function POST(req: NextRequest) {
  const auth = await resolveCompanyId(req)
  if (!auth.ok) return auth.response

  const binding = await db.companyPortalBinding.findUnique({
    where: { companyId: auth.companyId },
    select: { portalUrl: true },
  })
  return NextResponse.json({ portalUrl: binding?.portalUrl ?? null })
}

export async function PUT(req: NextRequest) {
  const auth = await resolveCompanyId(req)
  if (!auth.ok) return auth.response

  const result = normalizePortalEmbedUrl(String(auth.body?.portalUrl ?? ''))
  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: 400 })
  }

  await db.companyPortalBinding.upsert({
    where: { companyId: auth.companyId },
    create: { companyId: auth.companyId, portalUrl: result.url },
    update: { portalUrl: result.url },
  })
  return NextResponse.json({ portalUrl: result.url })
}
