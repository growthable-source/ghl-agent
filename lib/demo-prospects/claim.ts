/**
 * Claiming a demo: the prospect signed in and wants the agent for real.
 * Creates a fresh workspace named after their business (mirrors the
 * POST /api/workspaces create shape) and RE-PARENTS the demo assets
 * into it — agent, voice config (rides along via agentId), and the
 * crawled knowledge domain. Their demo becomes their real agent; no
 * rebuild. Idempotent: a second claim by the same user returns the
 * already-claimed workspace; a claim by a different user is refused.
 *
 * Deviation from the plan: `installSource: 'demo_prospect'` is not one
 * of the documented values on Workspace.installSource ('direct' |
 * 'ghl_marketplace' | 'shopify_app' | 'hubspot_marketplace' — see the
 * schema comment above that field) — the column itself is a bare
 * String? with no DB constraint, but onboarding copy / marketplace
 * attribution switch on that closed set. Per the plan's own fallback
 * instruction, this uses 'direct' instead of inventing an unrecognized
 * value.
 */
import { db } from '@/lib/db'
import { demoWorkspaceId } from './provision'

export type ClaimResult =
  | { ok: true; workspaceId: string; hadAgent: boolean }
  | { ok: false; reason: 'not_found' | 'claimed_by_other' | 'not_configured' }

export async function claimProspect(slug: string, userId: string): Promise<ClaimResult> {
  const demoWs = demoWorkspaceId()
  if (!demoWs) return { ok: false, reason: 'not_configured' }

  const prospect = await db.demoProspect.findUnique({ where: { slug } })
  if (!prospect) return { ok: false, reason: 'not_found' }

  if (prospect.status === 'claimed') {
    if (prospect.claimedByUserId === userId && prospect.claimedWorkspaceId) {
      return { ok: true, workspaceId: prospect.claimedWorkspaceId, hadAgent: Boolean(prospect.agentId) }
    }
    return { ok: false, reason: 'claimed_by_other' }
  }

  // Create the workspace (same shape as POST /api/workspaces).
  const baseSlug = prospect.businessName
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'workspace'
  const workspace = await db.workspace.create({
    data: {
      name: prospect.businessName,
      slug: `${baseSlug}-${Math.random().toString(36).slice(2, 8)}`,
      icon: '🎙️',
      installSource: 'direct',
      primaryCrmProvider: 'native',
      plan: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      members: { create: { userId, role: 'owner' } },
    },
    select: { id: true },
  })

  // CAS the claim BEFORE moving assets so two racing claims can't both
  // re-parent. Loser gets claimed_by_other (or their own workspace).
  const won = await db.demoProspect.updateMany({
    where: { id: prospect.id, status: { not: 'claimed' } },
    data: {
      status: 'claimed',
      claimedByUserId: userId,
      claimedWorkspaceId: workspace.id,
      expiresAt: null, // reaper must never touch claimed assets
    },
  })
  if (won.count === 0) {
    const fresh = await db.demoProspect.findUnique({ where: { slug } })
    if (fresh?.claimedByUserId === userId && fresh.claimedWorkspaceId) {
      return { ok: true, workspaceId: fresh.claimedWorkspaceId, hadAgent: Boolean(fresh.agentId) }
    }
    return { ok: false, reason: 'claimed_by_other' }
  }

  // Re-parent assets. Agent needs a Location in the NEW workspace
  // (required FK). Mirror the normal signup path (POST /api/workspaces):
  // auto-provision the native CRM Location — NOT a crmProvider:'none'
  // placeholder, which would contradict the workspace's
  // primaryCrmProvider:'native' above and make the first CRM-backed
  // tool the customer enables throw "CRM not connected". Upsert (the
  // route uses plain create) so a retried claim after a partial
  // failure doesn't trip the primary-key unique.
  if (prospect.agentId) {
    const nativeLocationId = `native:${workspace.id}`
    const location = await db.location.upsert({
      where: { id: nativeLocationId },
      create: {
        id: nativeLocationId,
        workspaceId: workspace.id,
        companyId: 'native',
        userId: 'native',
        userType: 'Location',
        scope: 'native',
        accessToken: 'native',
        refreshToken: 'native',
        refreshTokenId: 'native',
        expiresAt: new Date('2099-12-31T23:59:59.000Z'),
        crmProvider: 'native',
      },
      update: {},
      select: { id: true },
    })
    await db.agent.update({
      where: { id: prospect.agentId },
      data: {
        workspaceId: workspace.id,
        locationId: location.id,
        name: `${prospect.businessName} receptionist`,
        // Guard a rare provisioning race that can leave the agent's
        // knowledgeDomainIds empty even though the domain was created —
        // re-derive it here from the prospect row so claiming always
        // closes the gap. Leave untouched if there's no domain at all.
        ...(prospect.knowledgeDomainId
          ? { knowledgeDomainIds: [prospect.knowledgeDomainId], knowledgeScopeAll: false }
          : {}),
      },
    }).catch(err => console.error(`[demo-claim] agent re-parent failed for ${slug}:`, err))
  }
  if (prospect.knowledgeDomainId) {
    await db.knowledgeDomain.update({
      where: { id: prospect.knowledgeDomainId },
      data: { workspaceId: workspace.id, name: `${prospect.businessName} website` },
    }).catch(err => console.error(`[demo-claim] domain re-parent failed for ${slug}:`, err))
  }

  return { ok: true, workspaceId: workspace.id, hadAgent: Boolean(prospect.agentId) }
}
