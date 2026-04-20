import { auth } from './auth'

/**
 * Super-admin check for the help center editor.
 *
 * A user is a super-admin if EITHER:
 *   (a) their session email ends in @voxility.ai, OR
 *   (b) their session email is listed in SUPER_ADMIN_EMAILS (comma-separated
 *       env var — whitespace and case insignificant).
 *
 * Why the env-var allowlist exists: Google Workspace "domain aliases" make
 * (a) unreliable for staff. If voxility.ai is an alias on another
 * Workspace (e.g. growthable.io), Google's OIDC returns the PRIMARY email
 * on the underlying account regardless of which alias is typed at sign-in.
 * The email-domain check never matches in that case, so the allowlist
 * gives an escape hatch without hard-coding anyone's address in source.
 *
 * Example env (Vercel → Project → Environment Variables):
 *   SUPER_ADMIN_EMAILS=ryan@growthable.io,founder@example.com
 */
export async function isSuperAdmin(): Promise<{ ok: boolean; email: string | null }> {
  const session = await auth()
  const email = (session?.user?.email ?? null)?.toLowerCase() ?? null
  if (!email) return { ok: false, email: null }

  if (email.endsWith('@voxility.ai')) return { ok: true, email }

  const allowlist = (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  if (allowlist.includes(email)) return { ok: true, email }

  return { ok: false, email }
}
