/**
 * Who may change a workspace's white-label settings, and which settings
 * count as white-label.
 *
 * Role model for white-label customers (agreed with the first customer,
 * Oct 2026):
 *   - Owner (WorkspaceMember.role 'owner') and our platform admins:
 *     everything, including white-label.
 *   - Admin ("directors"): configure the whole product EXCEPT white-label,
 *     and must not be able to tell white-label settings exist. To them
 *     the product is simply their own branded app.
 *   - Support Agent ('agent'): chats and tickets only (./access-policy.ts).
 *
 * A super admin in a support session reaches the workspace as 'admin'
 * (lib/support-session.ts) and qualifies through the platform-admin path,
 * never through the owner path, so support mode can't be mistaken for
 * ownership.
 *
 * White-label settings = the custom domain, everything on the Custom
 * domain page (tab title, favicon, sign-in logo/colours/copy, which also
 * brand team emails), plus — once the workspace is unlocked — the
 * workspace logo (it is the fallback favicon + sidebar logo on the
 * branded domain) and each widget's "Powered by" line. Before unlock
 * those two are ordinary settings and admins keep them.
 *
 * Pure — no Prisma, no Next — so it is unit-tested.
 */

export type WhitelabelManagerKind = 'platform' | 'owner'

/** How the caller qualifies to manage white-label, or null when they don't. */
export function whitelabelManagerKind(
  memberRole: string | null | undefined,
  isPlatformAdmin: boolean,
): WhitelabelManagerKind | null {
  if (isPlatformAdmin) return 'platform'
  if (memberRole === 'owner') return 'owner'
  return null
}

/** Whether the workspace logo / widget "Powered by" line are white-label (owner-only) settings. */
export function brandingIsWhitelabel(whitelabelUnlocked: boolean): boolean {
  return whitelabelUnlocked
}
