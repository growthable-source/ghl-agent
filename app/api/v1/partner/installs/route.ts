/**
 * POST /api/v1/partner/installs — provision an AI chat widget for a
 * partner's customer, in one call.
 *
 * This is the help centre's upsell button. It creates the User,
 * Workspace, native Location, Agent (attached to the shared canonical
 * corpus) and ChatWidget, then returns the embed snippet plus a
 * single-use URL that iframes our widget builder inside the partner's
 * own admin UI.
 *
 * Idempotent on (provider, externalId): a retry after a network timeout
 * returns the same account rather than minting a second workspace.
 *
 * Auth: org-scope Bearer ApiKey only (lib/api-auth). The partner holds
 * one key and provisions on behalf of many customers.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok, parseLimit } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import {
  provisionPartnerInstall,
  ProvisionError,
  PARTNER_PROVIDER_HELP_CENTER,
} from '@/lib/partner/provision'
import { createBuilderToken } from '@/lib/partner/builder-token'
import { embedSnippet, builderUrl, portalUrl } from '@/lib/partner/embed'

// Provisioning does 5+ sequential writes plus a preset application.
export const maxDuration = 60

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
      widget?: Record<string, string>
      metadata?: Record<string, unknown>
    }

    const externalId = (body.externalId || '').trim().slice(0, 200)
    const email = (body.email || '').trim().toLowerCase()
    const businessName = (body.businessName || '').trim().slice(0, 120)

    if (!externalId) throw new AuthError(422, 'bad_param', 'externalId required')
    if (!EMAIL_RE.test(email)) throw new AuthError(422, 'bad_param', 'a valid email is required')
    if (!businessName) throw new AuthError(422, 'bad_param', 'businessName required')
    if (JSON.stringify(body.metadata ?? null).length > 20_000) {
      throw new AuthError(422, 'bad_param', 'metadata too large')
    }

    const result = await provisionPartnerInstall({
      // Single-partner today; the column exists so a second one can be
      // added without a schema change.
      provider: (body.provider || PARTNER_PROVIDER_HELP_CENTER).trim().slice(0, 40),
      externalId,
      email,
      businessName,
      helpCenterUrl: body.helpCenterUrl ?? null,
      widget: body.widget,
      metadata: body.metadata ?? null,
    })

    // Minted per response and consumed on first load, so the partner
    // should treat builderUrl as single-use and call the builder-link
    // endpoint for subsequent opens.
    const install = await db.partnerInstall.findUnique({
      where: { id: result.installId }, select: { userId: true },
    })
    const token = install?.userId
      ? await createBuilderToken(install.userId, result.workspaceId, result.widgetId)
      : null

    return ok({
      installId: result.installId,
      created: result.created,
      workspaceId: result.workspaceId,
      agentId: result.agentId,
      widget: { id: result.widgetId, publicKey: result.widgetPublicKey },
      embedSnippet: embedSnippet(result.widgetId, result.widgetPublicKey),
      builderUrl: token ? builderUrl(token) : null,
      // The customer's client portal — provisioned with the widget, fully
      // included for the trial, invite emailed to them directly. Null only
      // when the portal stage failed; the widget works regardless.
      portal: result.portalSlug
        ? { slug: result.portalSlug, url: portalUrl(result.portalSlug) }
        : null,
      trialEndsAt: result.trialEndsAt,
    }, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    if (err instanceof ProvisionError) {
      return errorResponse(new AuthError(err.status, err.code, err.message))
    }
    return errorResponse(err)
  }
})

/** GET — list installs this partner has provisioned. Support/ops view. */
export const GET = withApiLog(async (req: NextRequest) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)

    const url = new URL(req.url)
    const provider = (url.searchParams.get('provider') || PARTNER_PROVIDER_HELP_CENTER).slice(0, 40)
    const limit = parseLimit(url, 50, 200)

    const installs = await db.partnerInstall.findMany({
      where: { provider },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true, externalId: true, externalEmail: true, businessName: true,
        status: true, workspaceId: true, widgetId: true, createdAt: true,
      },
    })
    return ok({ installs }, { apiKeyId: key.apiKeyId, scope: key.scope, count: installs.length })
  } catch (err) {
    return errorResponse(err)
  }
})
