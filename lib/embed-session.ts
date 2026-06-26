/**
 * Embed-mode session cookie.
 *
 * Xovera sessions split into two cookies, intentionally:
 *
 *   __Secure-authjs.session-token       (SameSite=Lax)  — browser tabs
 *   __Secure-voxility-embed-session     (SameSite=None) — iframe inside CRM
 *
 * They point at the same `Session` table (different rows), but the
 * different SameSite values matter for security:
 *
 *   - SameSite=Lax cookies don't send in third-party iframes, so a
 *     malicious site that iframes app.xovera.io cannot piggyback on
 *     a user's passive browser session.
 *   - SameSite=None cookies travel in any iframe, which is required
 *     for the CRM-embedded experience to work across thousands of
 *     unknowable whitelabel parent domains.
 *
 * Middleware "promotes" the embed cookie's value into the regular
 * cookie name on the request side (request.cookies.set), so any
 * downstream auth() call sees a valid session without code changes
 * elsewhere. The promotion is request-scoped — it never reaches the
 * browser, so the cookies remain logically separate.
 */

export const EMBED_SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Secure-voxility-embed-session'
  : 'voxility-embed-session'

export const REGULAR_SESSION_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Secure-authjs.session-token'
  : 'authjs.session-token'

/**
 * Bound-workspace cookie. The SSO handshake writes the workspaceId it
 * resolved from `payload.activeLocation` into this cookie so subsequent
 * /dashboard hits know WHICH marketplace workspace this iframe session
 * is anchored to.
 *
 * Without this, a user with multiple marketplace-installed workspaces
 * (one per GHL sub-account) could be redirected to the wrong one when
 * they navigate to /dashboard root inside the iframe — the redirect
 * had no signal beyond "any workspace with installSource=ghl_marketplace".
 *
 * Re-asserted on every handshake, so switching sub-accounts in the
 * parent CRM updates the binding correctly on the next iframe load.
 */
export const EMBED_WORKSPACE_COOKIE = process.env.NODE_ENV === 'production'
  ? '__Secure-voxility-embed-workspace'
  : 'voxility-embed-workspace'
