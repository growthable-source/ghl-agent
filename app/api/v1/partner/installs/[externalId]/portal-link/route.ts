/**
 * POST /api/v1/partner/installs/{externalId}/portal-link
 *
 * A fresh single-use portal sign-in URL. The partner's dashboard calls
 * this when the customer clicks "Open your portal" — no invite email to
 * find, no password to set, straight into their numbers. Mirrors the
 * builder-link endpoint: mint per click, 10-minute TTL, never cache.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'
import { createPortalSsoToken } from '@/lib/partner/portal-token'
import { publicBaseUrl } from '@/lib/partner/embed'

type Params = { params: Promise<{ externalId: string }> }

export const POST = withApiLog(async (req: NextRequest, ctx: unknown) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    enforcePartnerRateLimit(key)

    const { externalId } = await (ctx as Params).params
    const provider = (new URL(req.url).searchParams.get('provider') || PARTNER_PROVIDER_HELP_CENTER).slice(0, 40)

    const install = await db.partnerInstall.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { widgetId: true, externalEmail: true, status: true },
    })
    if (!install) throw new AuthError(404, 'not_found', 'No install for that externalId')
    if (install.status === 'disabled') {
      throw new AuthError(409, 'disabled', 'This install is disabled — re-provision first.')
    }
    if (!install.widgetId) {
      throw new AuthError(409, 'not_ready', 'Provisioning has not finished — poll GET until ready.')
    }

    // Portal resolved through the widget's brand, same derivation the GET
    // status route uses. Missing portal = provisioned before portals
    // existed and not yet backfilled by a POST /installs retry.
    const widget = await db.chatWidget.findUnique({
      where: { id: install.widgetId },
      select: { brandId: true },
    })
    const link = widget?.brandId
      ? await db.portalBrand.findFirst({
          where: { brandId: widget.brandId },
          select: { portal: { select: { id: true, isActive: true } } },
        })
      : null
    if (!link?.portal?.isActive) {
      throw new AuthError(409, 'not_ready',
        'No portal exists for this install yet — call POST /installs again to backfill it.')
    }

    const token = await createPortalSsoToken(link.portal.id, install.externalEmail)

    return ok({
      portalUrl: `${publicBaseUrl()}/portal/sso?t=${encodeURIComponent(token)}`,
      expiresInSeconds: 600,
    }, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})
