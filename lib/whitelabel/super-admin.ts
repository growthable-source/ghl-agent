/**
 * Who may change a workspace's white-label settings (domain + branding).
 *
 * Role model for white-label customers:
 *   - Super Admin (our platform admins): everything, including white-label.
 *   - Workspace owner/admin: configure everything EXCEPT white-label.
 *   - Support Agent ('agent'): chats and tickets only.
 *
 * "Super Admin" is a platform admin session (lib/admin-auth.ts) at admin
 * rank or higher with 2FA satisfied — the same bar as unlocking
 * white-label and opening a support session. In practice staff reach the
 * settings page through Admin → Workspaces → Open workspace; the admin
 * cookie lives on our host, so these settings are never editable from the
 * customer's own domain.
 */

import { requireAdminRole, type AdminSession } from '@/lib/admin-auth'

/** The platform admin allowed to manage white-label settings, or null. */
export async function whitelabelManager(): Promise<AdminSession | null> {
  return requireAdminRole('admin')
}

export const WHITELABEL_FORBIDDEN_MESSAGE =
  'White-label settings are managed by your platform administrator.'
