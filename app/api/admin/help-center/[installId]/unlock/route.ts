import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAdminRole, logAdminActionAfter } from '@/lib/admin-auth'
import { getPlanDefaults, type PlanId } from '@/lib/plans'
import { syncHelpCenterArticles } from '@/lib/partner/article-sync'
import { provisionPartnerInstall } from '@/lib/partner/provision'

type Params = { params: Promise<{ installId: string }> }

// Registered installs get provisioned inline (5+ sequential writes).
export const maxDuration = 60

const PAID_PLANS = new Set(['starter', 'growth', 'scale'])

/**
 * POST — super-admin "unlock" for a free Help Center install.
 *
 * Body: {
 *   plan: 'starter' | 'growth' | 'scale',
 *   enableTicketing?: boolean,   // meaningful on 'scale' (the only tier
 *                                // whose plan gate includes ticketing)
 *   syncArticles?: boolean,      // crawl their help center into the
 *                                // agent's knowledge
 *   helpCenterUrl?: string,      // override/supply the URL to crawl
 * }
 *
 * The comped equivalent of the partner's PUT /installs/{id}/plan:
 * writes the plan + defaults, clears the trial clock, and deliberately
 * never touches stripe* fields — no Stripe rows is how support tells
 * manually-unlocked (and partner-billed) workspaces apart from
 * Xovera-billed ones. The unlock is recorded in install.metadata for
 * the admin list, and in the admin audit trail.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const session = await requireAdminRole('admin')
  if (!session) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { installId } = await params
  let install = await db.partnerInstall.findUnique({ where: { id: installId } })
  if (!install) return NextResponse.json({ error: 'Install not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const plan = typeof body.plan === 'string' ? body.plan : ''
  if (!PAID_PLANS.has(plan)) {
    return NextResponse.json({ error: 'plan must be starter, growth, or scale.' }, { status: 400 })
  }
  const enableTicketing = body.enableTicketing === true
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
      ...getPlanDefaults(plan as PlanId),
      trialEndsAt: null,
      planSelectedDuringTrial: null,
    },
  })

  if (enableTicketing) {
    await db.ticketingSettings.upsert({
      where: { workspaceId: install.workspaceId },
      create: { workspaceId: install.workspaceId, enabled: true },
      update: { enabled: true },
    })
  }

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
          plan,
          enableTicketing,
          articlesSynced: !!articles,
          by: session.email,
          at: new Date().toISOString(),
        },
      } as never,
    },
  })

  logAdminActionAfter({
    admin: session,
    action: 'unlock_help_center_install',
    target: install.id,
    meta: {
      businessName: install.businessName,
      workspaceId: install.workspaceId,
      plan,
      enableTicketing,
      syncArticles,
      articleError,
    },
  })

  return NextResponse.json({
    ok: true,
    plan,
    ticketingEnabled: enableTicketing,
    articles,
    articleError,
  })
}
