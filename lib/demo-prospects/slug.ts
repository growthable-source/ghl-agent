/**
 * Slug + domain helpers for the voice-demo prospecting funnel.
 * Pure functions — vitest-covered per the repo's lib-only test scope.
 */
import { randomBytes } from 'crypto'

/**
 * Normalize any website URL/host the prospecting tool sends into a bare
 * lowercase host ("acmeplumbing.com") used for idempotency — one live
 * demo per business domain. Strips protocol, "www.", path, and query.
 * Throws on unparseable input (the API surfaces this as a 400).
 */
export function normalizeWebsiteDomain(input: string): string {
  const trimmed = (input || '').trim()
  if (!trimmed) throw new Error('websiteUrl required')
  const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`)
  const host = url.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  if (!host.includes('.')) throw new Error('websiteUrl must include a domain')
  return host
}

/**
 * "Joe's Plumbing & Heating" → "joe-s-plumbing-heating-4f8a2c1d".
 * The 8-hex-char random suffix makes slugs unguessable/unenumerable —
 * the slug IS the credential for the public demo surfaces.
 */
export function generateProspectSlug(businessName: string): string {
  const base =
    (businessName || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40)
      .replace(/-$/, '') || 'demo'
  return `${base}-${randomBytes(4).toString('hex')}`
}
