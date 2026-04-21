/**
 * Internal-workspace detection.
 *
 * A workspace is "internal" when at least one member is signed in with an
 * email on the @voxility.ai domain, or when their email is on the
 * SUPER_ADMIN_EMAILS allowlist (covers the Google Workspace alias case
 * where the primary email is on a different domain).
 *
 * Internal workspaces bypass every billing/trial gate — credit card
 * required never gets in the way of staff, dogfooding, or demos. The
 * plan value on the Workspace row is honoured for display purposes but
 * isn't enforced.
 *
 * Kept as a lazy, per-request lookup rather than a cached flag on the
 * Workspace row so that (a) adding a @voxility.ai teammate to an existing
 * external workspace immediately makes it internal, and (b) removing the
 * last @voxility.ai member flips it back. One indexed query per request
 * is fine; the list of workspaces Voxility staff are members of is small.
 */

import { db } from './db'

function getAllowlist(): string[] {
  return (process.env.SUPER_ADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
}

function isInternalEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const e = email.toLowerCase()
  if (e.endsWith('@voxility.ai')) return true
  return getAllowlist().includes(e)
}

/**
 * Check whether a given workspace is internal. Returns true if any member
 * has an internal email. Cheap, indexed lookup via WorkspaceMember.
 */
export async function isInternalWorkspace(workspaceId: string): Promise<boolean> {
  try {
    const members = await db.workspaceMember.findMany({
      where: { workspaceId },
      select: { user: { select: { email: true } } },
    })
    return members.some(m => isInternalEmail(m.user?.email ?? null))
  } catch {
    // Treat lookup failures as "not internal" so a DB blip never
    // accidentally hands out free plans.
    return false
  }
}

/** Convenience: true when the signed-in user's email is internal. */
export function isInternalUserEmail(email: string | null | undefined): boolean {
  return isInternalEmail(email)
}
