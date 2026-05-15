/**
 * Pure presentation utilities shared by the various inbox sidebar
 * sections (visitor timeline, CRM context, AI summary). No state,
 * no React — safe to import into any extracted section.
 */

/** "2m ago" / "3h ago" / "5d ago". Past-tense only — these helpers
 *  format conversation activity, which is always historical. */
export function relTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

/** Strip the protocol and `www.` from a URL for compact display.
 *  Returns the input unchanged if it's not parseable. */
export function prettyUrl(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname + (u.search || '')
    return u.host.replace(/^www\./, '') + (path === '/' ? '' : path)
  } catch {
    return url
  }
}
