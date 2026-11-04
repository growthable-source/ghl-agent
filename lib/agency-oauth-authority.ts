/**
 * Callback-time authority check for the agency OAuth: may the actor named
 * in the (already signature-verified) state attach an agency to this
 * widget RIGHT NOW? Re-read from the DB, so access revoked between install
 * and callback is honoured.
 *
 *  - user actor:   admin+ member of the widget's workspace, or a super
 *                  admin in a support session for it (only when the
 *                  callback request carries that same user's session).
 *  - portal actor: an active portal user (or the portal's admin preview)
 *                  on an active portal, with access to the widget's brand.
 *                  Same rule as portal-install's `brandId in brandIds`.
 */

import { db } from '@/lib/db'
import { auth } from '@/lib/auth'
import { workspaceRoleHas } from '@/lib/require-workspace-role'
import { supportRoleFor } from '@/lib/support-session'
import type { AgencyOAuthActor } from '@/lib/agency-oauth-state'

export async function actorMayConnectWidget(
  actor: AgencyOAuthActor,
  widget: { id: string; workspaceId: string; brandId: string | null },
): Promise<boolean> {
  if (actor.kind === 'user') {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: actor.userId, workspaceId: widget.workspaceId } },
      select: { role: true },
    })
    let role = member?.role ?? null
    if (!role) {
      const session = await auth().catch(() => null)
      if (session?.user?.id === actor.userId) role = supportRoleFor(session, widget.workspaceId)
    }
    return !!role && workspaceRoleHas(role, 'admin')
  }

  if (!widget.brandId) return false
  const portal = await db.portal.findUnique({
    where: { id: actor.portalId },
    select: { isActive: true, portalBrands: { select: { brandId: true } } },
  })
  if (!portal?.isActive) return false

  if (actor.portalUserId === 'admin-preview') {
    return portal.portalBrands.some(b => b.brandId === widget.brandId)
  }

  const user = await db.portalUser.findUnique({
    where: { id: actor.portalUserId },
    select: { portalId: true, isActive: true, brandAssignments: { select: { brandId: true } } },
  })
  if (!user || !user.isActive || user.portalId !== actor.portalId) return false
  return user.brandAssignments.some(a => a.brandId === widget.brandId)
}
