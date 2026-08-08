/**
 * PUT /api/v1/partner/installs/{externalId}/plan
 *
 * The partner sold the upgrade in their own brand, on their own Stripe —
 * this endpoint is how the entitlement lands here. The org key asserting
 * "this customer paid" is the same trust that lets provisioning create
 * their account: the partner is the system of record for this customer's
 * money, we are the system of record for what the money buys.
 *
 * Body: { plan: "starter" | "growth" | "scale" | "canceled" }
 *
 * "canceled" returns the workspace to an expired-trial state rather than
 * deleting anything: the widget keeps answering (AI-only), the portal
 * pauses behind the teaser report, and a re-upgrade is one more PUT.
 *
 * Deliberately does NOT touch stripe* fields on the workspace — those
 * belong to Xovera's own checkout. A partner-billed workspace has plan
 * entitlements with no Stripe rows here, which is also how support can
 * tell at a glance who bills it.
 */
import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateApiKey, AuthError } from '@/lib/api-auth'
import { errorResponse, ok } from '@/lib/api-scope'
import { withApiLog } from '@/lib/api-log'
import { requirePartnerKey, enforcePartnerRateLimit } from '@/lib/partner/api-key'
import { PARTNER_PROVIDER_HELP_CENTER } from '@/lib/partner/provision'
import { getPlanDefaults, type PlanId } from '@/lib/plans'

type Params = { params: Promise<{ externalId: string }> }

const PAID_PLANS = ['starter', 'growth', 'scale'] as const

export const PUT = withApiLog(async (req: NextRequest, ctx: unknown) => {
  try {
    const key = await authenticateApiKey(req)
    requirePartnerKey(key)
    enforcePartnerRateLimit(key)

    const { externalId } = await (ctx as Params).params
    const provider = (new URL(req.url).searchParams.get('provider') || PARTNER_PROVIDER_HELP_CENTER).slice(0, 40)

    const body = (await req.json().catch(() => ({}))) as { plan?: string }
    const plan = (body.plan || '').trim()
    const isPaid = (PAID_PLANS as readonly string[]).includes(plan)
    if (!isPaid && plan !== 'canceled') {
      throw new AuthError(422, 'bad_param', `plan must be one of ${PAID_PLANS.join(', ')}, or "canceled"`)
    }

    const install = await db.partnerInstall.findUnique({
      where: { provider_externalId: { provider, externalId } },
      select: { workspaceId: true },
    })
    if (!install) throw new AuthError(404, 'not_found', 'No install for that externalId')
    if (!install.workspaceId) {
      throw new AuthError(409, 'not_ready', 'Provisioning has not finished — poll GET until ready.')
    }

    if (isPaid) {
      const defaults = getPlanDefaults(plan as PlanId)
      await db.workspace.update({
        where: { id: install.workspaceId },
        data: {
          plan,
          ...defaults,
          trialEndsAt: null,
          planSelectedDuringTrial: null,
        },
      })
    } else {
      // Canceled → expired trial, effective immediately. The partner's
      // Stripe already decided when access ends (they call this on the
      // cancellation webhook, which Stripe fires at period end).
      await db.workspace.update({
        where: { id: install.workspaceId },
        data: {
          plan: 'trial',
          ...getPlanDefaults('trial'),
          trialEndsAt: new Date(),
        },
      })
    }

    console.log(`[partner] plan set to ${plan} for install ${externalId}`)
    return ok({ plan: isPaid ? plan : 'canceled' }, { apiKeyId: key.apiKeyId, scope: key.scope })
  } catch (err) {
    return errorResponse(err)
  }
})
