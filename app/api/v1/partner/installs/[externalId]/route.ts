/**
 * GET    /api/v1/partner/installs/{externalId} — status + trial state.
 * DELETE /api/v1/partner/installs/{externalId} — deactivate the widget.
 *
 * The GET is what drives the partner's own in-product upsell prompt
 * ("your trial ends in 3 days"), so it carries plan/trial state as well
 * as usage.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'
import { embedSnippet } from '@/lib/partner/embed'
import { getEffectivePlan } from '@/lib/effective-plan'
import { invalidateWidgetAuthCache } from '@/lib/widget-auth'

type Params = { params: Promise<{ externalId: string }> }

async function loadInstall(req: NextRequest, externalId: string) {
  const provider = (new URL(req.url).searchParams.get('provider') || PARTNER_PROVIDER_HELP_CENTER).slice(0, 40)
  const install = await db.partnerInstall.findUnique({
    where: { provider_externalId: { provider, externalId } },
  })
  if (!install) throw new AuthError(404, 'not_found', 'No install for that externalId')
  return install
}

export const GET = withApiLog(async (req: NextRequest, ctx: unknown) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    const { externalId } = await (ctx as Params).params
    const install = await loadInstall(req, externalId)

    const widget = install.widgetId
      ? await db.chatWidget.findUnique({
          where: { id: install.widgetId },
          select: { id: true, publicKey: true, isActive: true, name: true },
        })
      : null

    // Gates read the OWNER's best plan across their workspaces, never
    // workspace.plan — that column is denormalized and historical.
    const plan = install.workspaceId ? await getEffectivePlan(install.workspaceId).catch(() => null) : null

    const conversationCount = install.widgetId
      ? await db.widgetConversation.count({ where: { widgetId: install.widgetId } }).catch(() => 0)
      : 0

    const trialEndsAt = plan?.trialEndsAt ?? null
    const trialDaysRemaining = trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / 86400000))
      : null

    return ok({
      installId: install.id,
      externalId: install.externalId,
      status: install.status,
      failureReason: install.failureReason,
      businessName: install.businessName,
      workspaceId: install.workspaceId,
      agentId: install.agentId,
      widget: widget && {
        id: widget.id,
        name: widget.name,
        isActive: widget.isActive,
        embedSnippet: embedSnippet(widget.id, widget.publicKey),
      },
      billing: plan && {
        plan: plan.plan,
        trialEndsAt,
        trialDaysRemaining,
        trialExpired: plan.trialExpired,
      },
      usage: { conversationCount },
      createdAt: install.createdAt,
    }, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})

/**
 * Deactivate — never hard-delete. The customer's conversation history,
 * their agent and their workspace all survive, so re-enabling is a flag
 * flip and support can still see what happened. Destroying an account
 * because a partner-side subscription lapsed is not ours to do.
 */
export const DELETE = withApiLog(async (req: NextRequest, ctx: unknown) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    const { externalId } = await (ctx as Params).params
    const install = await loadInstall(req, externalId)

    if (install.widgetId) {
      await db.chatWidget.update({
        where: { id: install.widgetId },
        data: { isActive: false },
      }).catch(() => { /* widget already gone */ })
      // The widget auth layer caches isActive for 30s; without this the
      // launcher keeps loading for up to half a minute after disable.
      invalidateWidgetAuthCache(install.widgetId)
    }
    await db.partnerInstall.update({
      where: { id: install.id },
      data: { status: 'disabled' },
    })

    return ok({ installId: install.id, status: 'disabled' },
      { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})
