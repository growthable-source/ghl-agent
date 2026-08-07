/**
 * POST /api/v1/partner/installs/{externalId}/builder-link
 *
 * Mint a fresh single-use URL for iframing the widget builder. The
 * partner calls this every time the customer opens the builder — tokens
 * are consumed on first load and live 10 minutes, so there is nothing
 * long-lived for the partner to store or leak.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'
import { createBuilderToken } from '@/lib/partner/builder-token'
import { builderUrl } from '@/lib/partner/embed'

type Params = { params: Promise<{ externalId: string }> }

export const POST = withApiLog(async (req: NextRequest, ctx: unknown) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    // Each call mints a credential that signs someone into a workspace,
    // so it gets the same cap as provisioning.
    enforcePartnerRateLimit(key)

    const { externalId } = await (ctx as Params).params
    const provider = (new URL(req.url).searchParams.get('provider') || PARTNER_PROVIDER_HELP_CENTER).slice(0, 40)

    const install = await db.partnerInstall.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { status: true, userId: true, workspaceId: true, widgetId: true },
    })
    if (!install) throw new AuthError(404, 'not_found', 'No install for that externalId')
    if (install.status === 'disabled') {
      throw new AuthError(409, 'disabled', 'This install is disabled')
    }
    if (!install.userId || !install.workspaceId || !install.widgetId) {
      throw new AuthError(409, 'not_ready',
        'Provisioning has not finished for this install yet')
    }

    const token = await createBuilderToken(install.userId, install.workspaceId, install.widgetId)
    return ok({
      builderUrl: builderUrl(token),
      // Callers should redirect/iframe immediately rather than caching.
      expiresInSeconds: 600,
    }, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})
