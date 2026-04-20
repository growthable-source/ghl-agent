import { auth } from './auth'

/**
 * Super-admin check for the help center editor.
 *
 * A "super admin" is anyone signed in with an email under the @voxility.ai
 * domain — that's the only way to access the authoring surface. Kept
 * intentionally simple and one-liner-ish: there's no separate role column,
 * no admin-assignment UI, no invitation flow. Voxility staff sign in with
 * a voxility.ai email via Google OAuth and they're admins.
 *
 * If we ever need guest admins or granular roles, add a column to the User
 * model and layer the check here — callers don't need to change.
 */
export async function isSuperAdmin(): Promise<{ ok: boolean; email: string | null }> {
  const session = await auth()
  const email = session?.user?.email ?? null
  const ok = !!email && email.toLowerCase().endsWith('@voxility.ai')
  return { ok, email }
}
