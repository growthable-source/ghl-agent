import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { getPlanDefaults } from '@/lib/plans'
import { syncHelpCenterArticles } from '@/lib/partner/article-sync'
import { provisionPartnerInstall } from '@/lib/partner/provision'
import { isGrowthablePlan } from '@/lib/partner/growthable-plans'

type Params = { params: Promise<{ installId: string }> }

// Registered installs get provisioned inline (5+ sequential writes).
export const maxDuration = 60

// Every unlock grants the full internal capability set — the
// GROWTHABLE plan is the commercial fact we record; Xovera tiers are
// an implementation detail of our own support engine.
const XOVERA_PLAN = 'scale'

/**
 * POST — super-admin "unlock" for a free Help Center install.
 *
 * Body: {
 *   growthablePlan: GrowthablePlanId,  // the plan the customer is on
 *                                      // (growthable.io/pricing)
 *   syncArticles?: boolean,            // crawl their help center into
 *                                      // the agent's knowledge
 *   helpCenterUrl?: string,            // override/supply the crawl URL
 * }
 *
 * Grants everything: internal 'scale' entitlement, ticketing on, and
 * (via the post-unlock push) GKB Pro. The comped equivalent of the
 * partner's PUT /installs/{id}/plan: writes the plan + defaults,
 * clears the trial clock, and deliberately never touches stripe*
 * fields — no Stripe rows is how support tells manually-unlocked
 * workspaces apart from Xovera-billed ones.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { installId } = await params
  let install = await db.partnerInstall.findUnique({ where: { id: installId } })
  if (!install) return NextResponse.json({ error: 'Install not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  if (!isGrowthablePlan(body.growthablePlan)) {
    return NextResponse.json({ error: 'growthablePlan must be one of the plans on growthable.io/pricing.' }, { status: 400 })
  }
  const growthablePlan = body.growthablePlan
  const plan = XOVERA_PLAN
  const syncArticles = body.syncArticles === true

  const meta = (install.metadata ?? {}) as Record<string, unknown>
  const helpCenterUrl = typeof body.helpCenterUrl === 'string' && body.helpCenterUrl.trim()
    ? body.helpCenterUrl.trim()
    : typeof meta.helpCenterUrl === 'string' ? meta.helpCenterUrl : null
  if (syncArticles && !helpCenterUrl) {
    return NextResponse.json({ error: 'No help center URL on record — pass helpCenterUrl to sync articles.' }, { status: 400 })
  }

  // Register-only rows (and stuck retries) have no tenant yet — build it
  // now through the same idempotent path the partner's upsell uses, so
  // an unlock is one action regardless of whether the customer ever
  // clicked "Add AI chat widget."
  if (!install.workspaceId || !install.agentId) {
    try {
      await provisionPartnerInstall({
        provider: install.provider,
        externalId: install.externalId,
        email: install.externalEmail,
        businessName: install.businessName,
        helpCenterUrl,
        metadata: meta,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return NextResponse.json({ error: `Provisioning failed: ${msg}` }, { status: 502 })
    }
    install = await db.partnerInstall.findUnique({ where: { id: installId } })
    if (!install?.workspaceId || !install.agentId) {
      return NextResponse.json({ error: 'Provisioning did not complete — check the install row and retry.' }, { status: 502 })
    }
  }

  await db.workspace.update({
    where: { id: install.workspaceId },
    data: {
      plan,
      ...getPlanDefaults(plan),
      trialEndsAt: null,
      planSelectedDuringTrial: null,
    },
  })

  // Ticketing is part of every unlock — these customers can't reach the
  // settings page to flip it themselves.
  await db.ticketingSettings.upsert({
    where: { workspaceId: install.workspaceId },
    create: { workspaceId: install.workspaceId, enabled: true },
    update: { enabled: true },
  })

  let articles: Awaited<ReturnType<typeof syncHelpCenterArticles>> | null = null
  let articleError: string | null = null
  if (syncArticles && helpCenterUrl) {
    try {
      articles = await syncHelpCenterArticles({
        workspaceId: install.workspaceId,
        agentId: install.agentId,
        url: helpCenterUrl,
      })
    } catch (err) {
      // The plan grant stands even when the crawl kickoff fails —
      // surface the reason so the admin can fix the URL and re-run.
      articleError = err instanceof Error ? err.message : String(err)
    }
  }

  await db.partnerInstall.update({
    where: { id: install.id },
    data: {
      metadata: {
        ...meta,
        ...(helpCenterUrl ? { helpCenterUrl } : {}),
        unlock: {
          growthablePlan,
          plan,
          articlesSynced: !!articles,
          by: session.email,
          at: new Date().toISOString(),
        },
      } as never,
    },
  })

  // Tell the help-center product right away so the widget appears on
  // the customer's site and their Pro features light up — no scripts,
  // no buttons, no waiting for their next dashboard visit. Best-effort:
  // GKB also has a manual "Sync from Xovera" button as the fallback.
  let partnerSynced = false
  const syncUrl = process.env.HELP_CENTER_SYNC_URL
  const syncSecret = process.env.HELP_CENTER_SYNC_SECRET
  if (syncUrl && syncSecret) {
    try {
      const res = await fetch(syncUrl, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${syncSecret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ externalId: install.externalId }),
        signal: AbortSignal.timeout(10_000),
      })
      partnerSynced = res.ok
      if (!res.ok) console.warn(`[help-center unlock] partner sync returned ${res.status}`)
    } catch (err) {
      console.warn('[help-center unlock] partner sync failed:', err instanceof Error ? err.message : String(err))
    }
  }

  logAdminActionAfter({
    admin: session,
    action: 'unlock_help_center_install',
    target: install.id,
    meta: {
      businessName: install.businessName,
      workspaceId: install.workspaceId,
      growthablePlan,
      plan,
      syncArticles,
      articleError,
      partnerSynced,
    },
  })

  return NextResponse.json({
    ok: true,
    growthablePlan,
    plan,
    articles,
    articleError,
    partnerSynced,
  })
}
