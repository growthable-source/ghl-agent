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
import { embedSnippet, portalUrl } from '@/lib/partner/embed'
import { MINUTES_PER_HANDLED } from '@/lib/portal/report-email-render'
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
          select: { id: true, publicKey: true, isActive: true, name: true, brandId: true },
        })
      : null

    // The client portal, derived through the widget's brand rather than
    // stored on the install — the association IS the brand link, and
    // deriving it means installs backfilled later need no migration.
    let portal: { slug: string; url: string } | null = null
    if (widget?.brandId) {
      const link = await db.portalBrand.findFirst({
        where: { brandId: widget.brandId },
        select: { portal: { select: { slug: true, isActive: true } } },
      }).catch(() => null)
      if (link?.portal?.isActive) {
        portal = { slug: link.portal.slug, url: portalUrl(link.portal.slug) }
      }
    }

    // Gates read the OWNER's best plan across their workspaces, never
    // workspace.plan — that column is denormalized and historical.
    const plan = install.workspaceId ? await getEffectivePlan(install.workspaceId).catch(() => null) : null

    // The install's OWN workspace plan, distinct from `plan` above.
    // getEffectivePlan takes the owner's best across every workspace
    // they own, so a help-centre owner who also owns an unrelated paid
    // workspace would read back "paid" for this install. The partner
    // keys entitlements (e.g. GKB Pro) on THIS field so one customer's
    // other business can't light up a different centre's features.
    const workspacePlan = install.workspaceId
      ? (await db.workspace.findUnique({ where: { id: install.workspaceId }, select: { plan: true } }).catch(() => null))?.plan ?? null
      : null

    const conversationCount = install.widgetId
      ? await db.widgetConversation.count({ where: { widgetId: install.widgetId } }).catch(() => 0)
      : 0

    // Last-7-days numbers for the partner's own dashboard card. Same
    // definitions as the portal report email (aiHandled = real exchange,
    // never human-assigned; time saved = aiHandled × MINUTES_PER_HANDLED)
    // so the number the customer sees in GKB matches the one in their
    // report email — two different figures for "time saved" reads as one
    // of them lying.
    const since = new Date(Date.now() - 7 * 86_400_000)
    const [aiHandled7d, csatAgg] = install.widgetId
      ? await Promise.all([
          db.widgetConversation.count({
            where: {
              widgetId: install.widgetId, createdAt: { gte: since },
              assignedUserId: null, messages: { some: { role: 'agent' } },
            },
          }).catch(() => 0),
          db.widgetConversation.aggregate({
            where: { widgetId: install.widgetId, csatRating: { not: null } },
            _avg: { csatRating: true }, _count: { csatRating: true },
          }).catch(() => null),
        ])
      : [0, null]

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
        // publicKey is also baked into the snippet; exposed here as a
        // field so partners reconciling install state (e.g. after an
        // admin-side provision) don't have to parse it back out of HTML.
        publicKey: widget.publicKey,
        embedSnippet: embedSnippet(widget.id, widget.publicKey),
      },
      portal,
      billing: plan && {
        plan: plan.plan,
        // This install's OWN plan — key entitlements on this, not `plan`.
        workspacePlan,
        trialEndsAt,
        trialDaysRemaining,
        trialExpired: plan.trialExpired,
      },
      usage: {
        conversationCount,
        aiHandledLast7Days: aiHandled7d,
        timeSavedMinutesLast7Days: aiHandled7d * MINUTES_PER_HANDLED,
        csatAverage: csatAgg?._avg.csatRating ?? null,
        csatCount: csatAgg?._count.csatRating ?? 0,
      },
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
