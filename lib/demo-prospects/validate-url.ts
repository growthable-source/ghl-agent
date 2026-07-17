/**
 * SSRF guard for the public "train my AI receptionist" endpoint. Anyone
 * holding a demo slug can submit an arbitrary websiteUrl — this is the
 * one place that input gets validated before it's ever handed to the
 * crawler (which will happily fetch whatever it's pointed at).
 *
 * Pure + vitest-covered. No network calls here — DNS-rebinding-style
 * attacks (a hostname that resolves to a private IP at fetch time) are
 * out of scope for this helper; the crawler's own fetch layer is the
 * place to add resolved-IP checks if that's ever needed.
 */
import { normalizeWebsiteDomain } from './slug'

export class InvalidUrlError extends Error {}

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
const BLOCKED_SUFFIXES = ['.local', '.internal', '.lan', '.home', '.arpa']

/**
 * Parse + validate a prospect-submitted website URL. Returns the
 * normalized (https-defaulted) URL string and its bare host, or throws
 * InvalidUrlError with a message safe to surface to the caller.
 */
export function validatePublicUrl(input: string): { normalizedUrl: string; domain: string } {
  const trimmed = (input || '').trim()
  if (!trimmed) throw new InvalidUrlError('websiteUrl is required')

  let url: URL
  try {
    url = new URL(trimmed.startsWith('http://') || trimmed.startsWith('https://') ? trimmed : `https://${trimmed}`)
  } catch {
    throw new InvalidUrlError('websiteUrl is not a valid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InvalidUrlError('websiteUrl must be http or https')
  }

  const hostname = url.hostname.toLowerCase()

  // IPv6 literals arrive bracketed in url.hostname is actually stripped of
  // brackets by the URL parser, but a bare "::1" etc still round-trips —
  // guard on colon presence as the IPv6 signal.
  if (hostname.includes(':')) {
    throw new InvalidUrlError('websiteUrl must not be an IP address')
  }
  if (IPV4_RE.test(hostname)) {
    throw new InvalidUrlError('websiteUrl must not be an IP address')
  }
  if (hostname === 'localhost' || hostname === '0.0.0.0') {
    throw new InvalidUrlError('websiteUrl must not point at localhost')
  }
  if (!hostname.includes('.')) {
    throw new InvalidUrlError('websiteUrl must include a domain')
  }
  if (BLOCKED_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    throw new InvalidUrlError('websiteUrl must be a public domain')
  }

  // Reuses the same normalization the registration path uses, so the
  // "does this differ from what's stored" comparison is apples-to-apples.
  const domain = normalizeWebsiteDomain(url.toString())
  return { normalizedUrl: url.toString(), domain }
}
