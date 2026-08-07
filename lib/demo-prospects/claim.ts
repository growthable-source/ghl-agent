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
import { provisionWorkspace, ensureNativeLocation } from '@/lib/provision-workspace'
import { demoWorkspaceId } from './provision'
import { getPurchase } from '@/lib/demo-purchase/state'

export type ClaimResult =
  | { ok: true; workspaceId: string; hadAgent: boolean }
  | { ok: false; reason: 'not_found' | 'claimed_by_other' | 'not_configured' | 'purchase_in_progress' }

/**
 * `opts.viaPurchase` — set by lib/demo-purchase/fulfill.ts, the ONLY
 * caller allowed to claim a prospect that has an in-flight purchase.
 * Every other caller (currently just app/try/[slug]/claim/page.tsx, the
 * free auth-claim CTA) must NOT be able to claim a prospect for free
 * while a buyer is mid-payment — the webhook's later claimProspect call
 * would then hit claimed_by_other and the buyer's money would land
 * nowhere. See CLAUDE.md-adjacent review notes: "free-claim can orphan
 * a paying customer."
 */
export async function claimProspect(
  slug: string,
  userId: string,
  opts: { viaPurchase?: boolean } = {},
): Promise<ClaimResult> {
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

  if (!opts.viaPurchase) {
    const purchase = getPurchase(prospect.metadata)
    // Any purchase record at all means checkout_started-or-beyond (it's
    // the first state the machine ever writes) — a buyer may be
    // mid-payment right now. Only let the free-claim path through when
    // the claiming user IS that buyer (their account email matches the
    // checkout email); otherwise politely refuse rather than race the
    // webhook's own claim.
    if (purchase) {
      let isBuyer = false
      if (purchase.contactEmail) {
        const claimingUser = await db.user.findUnique({ where: { id: userId }, select: { email: true } })
        if (claimingUser?.email && claimingUser.email.toLowerCase() === purchase.contactEmail.toLowerCase()) {
          isBuyer = true
        }
      }
      if (!isBuyer) {
        return { ok: false, reason: 'purchase_in_progress' }
      }
    }
  }

  // Create the workspace. Shared with POST /api/workspaces and the
  // partner provisioning API — see lib/provision-workspace.ts, which
  // also handles the native Location the demo agent gets re-parented to
  // below.
  const workspace = await provisionWorkspace({
    name: prospect.businessName,
    ownerUserId: userId,
    icon: '🎙️',
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

  // Re-parent assets. The agent needs a Location in the NEW workspace
  // (required FK). provisionWorkspace already created the native one —
  // NOT a crmProvider:'none' placeholder, which would contradict the
  // workspace's primaryCrmProvider:'native' and make the first
  // CRM-backed tool the customer enables throw "CRM not connected".
  if (prospect.agentId) {
    // Idempotent, so a retried claim after a partial failure is fine.
    if (!(await ensureNativeLocation(workspace.id))) {
      return { ok: false, reason: 'not_configured' }
    }
    await db.agent.update({
      where: { id: prospect.agentId },
      data: {
        workspaceId: workspace.id,
        locationId: `native:${workspace.id}`,
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
