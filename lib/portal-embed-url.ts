/**
 * Validation/normalization for the "portal URL" an agency saves from the
 * embedded GHL landing page (app/embedded/leadconnector/portal).
 *
 * By design (see the 2026-07-23 spec) this is a RAW URL — we do not
 * check it against the Portal table. The only hard rules:
 *
 *   - https only (the value is rendered as an iframe src inside GHL;
 *     http would be blocked as mixed content anyway),
 *   - must round-trip through the URL parser (kills javascript: etc.),
 *   - no embedded credentials (user:pass@host is never legitimate here
 *     and is a classic phishing shape),
 *   - normalized via URL#toString() so stored values compare stably.
 *
 * A bare "portal.example.com" gets https:// prepended — operators paste
 * hostnames as often as full URLs.
 */

export type PortalEmbedUrlResult =
  | { ok: true; url: string }
  | { ok: false; reason: string }

export function normalizePortalEmbedUrl(input: string): PortalEmbedUrlResult {
  const trimmed = input.trim()
  if (!trimmed) return { ok: false, reason: 'Enter a portal URL' }

  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return { ok: false, reason: 'That does not look like a valid URL' }
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Portal URL must use https://' }
  }
  if (!parsed.hostname || parsed.username || parsed.password) {
    return { ok: false, reason: 'That does not look like a valid URL' }
  }

  return { ok: true, url: parsed.toString() }
}
