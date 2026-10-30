/**
 * Server-side resolution of who may change a workspace's white-label
 * settings (domain + branding). The rule itself lives in
 * ./manage-policy.ts: the workspace owner, or a platform admin.
 *
 * "Platform admin" is a platform admin session (lib/admin-auth.ts) at
 * admin rank or higher with 2FA satisfied — the same bar as unlocking
 * white-label and opening a support session. Callers must ALSO check the
 * caller reaches the workspace (requireWorkspaceAccess), which enforces
 * the white-label host binding.
 *
 * Admins (the customer's "directors") get null here, and every surface
 * treats null as "this feature doesn't exist": no nav entry, the page
 * 404s, the API answers 404 for writes and strips white-label fields
 * from reads (whitelabelHidden below).
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { requireAdminRole, type AdminSession } from '@/lib/admin-auth'
import { findMemberRole } from '@/lib/support-session'
import { brandingIsWhitelabel, whitelabelManagerKind } from './manage-policy'

export type WhitelabelManager =
  | { kind: 'platform'; admin: AdminSession }
  | { kind: 'owner'; userId: string }

/** The caller allowed to manage this workspace's white-label settings, or null. */
export async function whitelabelManager(workspaceId: string): Promise<WhitelabelManager | null> {
  const admin = await requireAdminRole('admin')
  if (admin) return { kind: 'platform', admin }
  const session = await auth()
  const member = await findMemberRole(session, workspaceId)
  const userId = session?.user?.id
  return whitelabelManagerKind(member?.role, false) === 'owner' && userId ? { kind: 'owner', userId } : null
}

/**
 * The refusal non-managers get. A plain 404 rather than a 403 naming the
 * feature: directors must not learn that white-label settings exist.
 */
export function whitelabelHidden(): NextResponse {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/**
 * Refusal for changing a setting that becomes white-label once the
 * workspace is unlocked (workspace logo, widget "Powered by" line), or
 * null when the caller may change it. See ./manage-policy.ts.
 */
export async function brandingLockedFor(workspaceId: string): Promise<NextResponse | null> {
  const ws = await db.workspace.findUnique({ where: { id: workspaceId }, select: { whitelabelUnlocked: true } })
  if (!brandingIsWhitelabel(!!ws?.whitelabelUnlocked)) return null
  return (await whitelabelManager(workspaceId)) ? null : whitelabelHidden()
}
