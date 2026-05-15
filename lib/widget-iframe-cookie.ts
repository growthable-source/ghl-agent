/**
 * Visitor cookieId resolver — shared by the chat embed iframe and the
 * call iframe. Both used to inline the same getCookieId() function;
 * they're identical now, by design.
 *
 * Precedence (each falls through to the next on miss):
 *   1. URL param `cid` — set by widget.js on the host page when it
 *      builds the iframe src. Authoritative — parent-page page-view
 *      tracking already uses this cookieId, so the iframe must agree
 *      or events + conversations end up on separate visitor rows.
 *   2. iframe localStorage — fallback for direct iframe loads
 *      (preview URLs, dev tools, etc) that didn't come through
 *      widget.js.
 *   3. Fresh random id — last resort.
 *
 * Whatever we resolve gets mirrored into iframe localStorage so a
 * standalone iframe refresh (without re-parent-loading) keeps the
 * same identity.
 *
 * Format: c_<base36>. The events endpoint regex-validates this shape
 * before accepting a cid from a URL param, so we keep generation
 * consistent.
 */

export const VISITOR_COOKIE_KEY = 'voxility_visitor_id'
const CID_FORMAT = /^c_[A-Za-z0-9]{6,64}$/

export function resolveVisitorCookieId(cidFromUrl: string | null | undefined): string {
  if (typeof window === 'undefined') return ''
  if (cidFromUrl && CID_FORMAT.test(cidFromUrl)) {
    try { window.localStorage.setItem(VISITOR_COOKIE_KEY, cidFromUrl) } catch {}
    return cidFromUrl
  }
  let id: string | null = null
  try { id = window.localStorage.getItem(VISITOR_COOKIE_KEY) } catch {}
  if (id) return id
  const fresh = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
  try { window.localStorage.setItem(VISITOR_COOKIE_KEY, fresh) } catch {}
  return fresh
}
