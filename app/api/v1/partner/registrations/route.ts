/**
 * POST /api/v1/partner/registrations — make a help center KNOWN to
 * Xovera without provisioning anything.
 *
 * The partner calls this when a customer claims a free help center.
 * It writes one PartnerInstall row with status 'registered' — no User,
 * no Workspace, no widget, no trial clock, no emails — purely so the
 * account shows up on Admin → Help Center, where a super admin can
 * later provision + unlock it in one action. Full provisioning still
 * happens via POST /installs (customer clicks the upsell) or the admin
 * unlock; both are idempotent on (provider, externalId), and a
 * 'registered' row upgrades in place because provisioning's early-
 * return requires a workspaceId this row doesn't have.
 *
 * Idempotent: re-registering an install in ANY state is a no-op that
 * reports the current status — the partner can fire-and-forget this
 * from their signup funnel.
 *
 * Auth: org-scope Bearer ApiKey, same as /installs.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const POST = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    enforcePartnerRateLimit(key)

    const body = (await req.json().catch(() => ({}))) as {
      externalId?: string
      email?: string
      businessName?: string
      helpCenterUrl?: string
      provider?: string
      metadata?: Record<string, unknown>
    }

    const externalId = (body.externalId || '').trim().slice(0, 200)
    const email = (body.email || '').trim().toLowerCase()
    const businessName = (body.businessName || '').trim().slice(0, 120)
    const provider = (body.provider || PARTNER_PROVIDER_HELP_CENTER).trim().slice(0, 40)

    if (!externalId) throw new AuthError(422, 'bad_param', 'externalId required')
    if (!EMAIL_RE.test(email)) throw new AuthError(422, 'bad_param', 'a valid email is required')
    if (!businessName) throw new AuthError(422, 'bad_param', 'businessName required')
    if (JSON.stringify(body.metadata ?? null).length > 20_000) {
      throw new AuthError(422, 'bad_param', 'metadata too large')
    }

    const metadata = {
      ...(body.metadata ?? {}),
      ...(body.helpCenterUrl ? { helpCenterUrl: body.helpCenterUrl } : {}),
    }

    let install
    try {
      install = await db.partnerInstall.create({
        data: {
          provider,
          externalId,
          externalEmail: email,
          businessName,
          status: 'registered',
          metadata: (Object.keys(metadata).length > 0 ? metadata : undefined) as never,
        },
      })
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err
      // Already known (registered, provisioning, ready, …) — keep the
      // row and its state, but REFRESH the partner-supplied facts:
      // email, name, and especially helpCenterUrl. A re-register is how
      // the partner corrects a wrong URL (it has already happened), and
      // silently keeping stale metadata made that impossible.
      const existing = await db.partnerInstall.findUnique({
        where: { provider_externalId: { provider, externalId } },
      })
      if (!existing) throw err
      const mergedMeta = {
        ...((existing.metadata as Record<string, unknown> | null) ?? {}),
        ...metadata,
      }
      install = await db.partnerInstall.update({
        where: { id: existing.id },
        data: {
          externalEmail: email,
          businessName,
          metadata: (Object.keys(mergedMeta).length > 0 ? mergedMeta : undefined) as never,
        },
      })
    }

    return ok(
      { installId: install.id, status: install.status },
      { apiKeyId: key.apiKeyId, scope: key.scope },
    )
  } catch (err) {
    return errorResponse(err)
  }
})
