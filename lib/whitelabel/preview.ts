/**
 * White-label TEST MODE — server side. Pure token helpers live in
 * ./preview-token.ts.
 *
 * On a non-production build, a browser holding a valid `wl_preview`
 * cookie (set by /api/sign-in/preview from a super admin's test link)
 * gets OUR host treated as that workspace's white-label domain:
 * resolveTeamBrand and customHostWorkspaceId return the workspace, so the
 * branded /sign-in, the branded dashboard and the one-workspace binding
 * all behave exactly as on the real domain. Middleware's custom-host
 * allowlist does not apply (it is host-based), so /admin and /login stay
 * reachable in test mode.
 *
 * Production never honours the cookie (previewModeAllowed), so nothing
 * here changes live behaviour.
 */

import { cookies } from 'next/headers'
import { PREVIEW_COOKIE, mintPreviewToken, previewModeAllowed, verifyPreviewToken } from './preview-token'

function secret(): string | undefined {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || undefined
}

export function previewModeAvailable(): boolean {
  return previewModeAllowed({ VERCEL_ENV: process.env.VERCEL_ENV, NODE_ENV: process.env.NODE_ENV })
}

/** Test-mode workspace for this browser, or null (production, no/invalid cookie). */
export async function previewWorkspaceId(): Promise<string | null> {
  if (!previewModeAvailable()) return null
  let token: string | undefined
  try {
    token = (await cookies()).get(PREVIEW_COOKIE)?.value
  } catch {
    return null // outside a request scope
  }
  return verifyPreviewToken(token, secret())
}

/** A test-link token for `workspaceId`, or null when test mode isn't available here. */
export function createPreviewToken(workspaceId: string): string | null {
  const s = secret()
  if (!previewModeAvailable() || !s) return null
  return mintPreviewToken(workspaceId, s)
}

export function checkPreviewToken(token: string | null | undefined): string | null {
  if (!previewModeAvailable()) return null
  return verifyPreviewToken(token, secret())
}

/** Path of the link that turns test mode on (optionally prefilling an email). */
export function previewLinkPath(token: string, email?: string | null): string {
  const q = new URLSearchParams({ t: token })
  if (email) q.set('email', email)
  return `/api/sign-in/preview?${q.toString()}`
}
