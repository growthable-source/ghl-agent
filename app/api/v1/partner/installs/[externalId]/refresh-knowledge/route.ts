/**
 * POST /api/v1/partner/installs/{externalId}/refresh-knowledge
 *
 * The partner (help center) calls this when a customer publishes or
 * edits help-center content, so the AI widget's knowledge reflects it
 * within a minute instead of waiting out the ~7-day auto-recrawl.
 *
 * It enqueues a FORCED re-crawl of the install's already-synced "Help
 * center articles" source(s) — forced so edits to existing pages are
 * re-fetched, not just brand-new URLs — deduped against any in-flight
 * run. Cheap and coalescing: the partner can fire it freely (it should
 * still debounce per-centre to respect the org key's write budget), and
 * repeated calls within a crawl window collapse to one run.
 *
 * No-op (200, queued:0) when the install was never unlocked with
 * articles — there's nothing to refresh yet.
 *
 * Auth: org-scope Bearer ApiKey, same as the other partner routes.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'
import { refreshHelpCenterArticles } from '@/lib/partner/article-sync'

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
      select: { workspaceId: true },
    })
    if (!install) throw new AuthError(404, 'not_found', 'No install for that externalId')
    if (!install.workspaceId) {
      throw new AuthError(409, 'not_ready', 'Provisioning has not finished — poll GET until ready.')
    }

    const result = await refreshHelpCenterArticles(install.workspaceId)
    console.log(`[partner] knowledge refresh for ${externalId}: queued ${result.queued}/${result.sources} source(s)`)
    return ok(result, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})
