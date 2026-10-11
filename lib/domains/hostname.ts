/**
 * Pure helpers for workspace white-label domains (no Prisma, no fetch —
 * unit-testable, and safe to import from Edge middleware).
 *
 * Product rule: SUBDOMAINS ONLY (live.acme.com, not acme.com). An apex
 * domain can't carry a CNAME, so supporting it would mean handing out
 * an A record that breaks the moment Vercel's anycast IP changes, and it
 * would pull the customer's whole website onto us if they mis-pointed it.
 */

import { isPrimaryHost, OWN_DOMAINS } from './primary-hosts'

/**
 * Operator-entered custom domain → a clean hostname, or null when blank
 * or not a valid public hostname. Strips protocol/path/port, lowercases,
 * and requires at least one dot (rejects "localhost"/"acme").
 */
export function normalizeCustomDomain(input: string | null | undefined): string | null {
  if (!input) return null
  let v = input.trim().toLowerCase()
  if (!v) return null
  v = v.replace(/^[a-z]+:\/\//, '') // strip protocol
  v = v.split('/')[0] // strip path
  v = v.split(':')[0] // strip port
  v = v.replace(/\.$/, '') // strip trailing dot
  // Hostname: dot-separated labels, letters/digits/hyphen, 2+ labels,
  // TLD ≥ 2 letters. Deliberately rejects single-label hosts.
  if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v)) {
    return null
  }
  return v
}

/**
 * Second-level labels that act like a TLD when paired with a 2-letter
 * ccTLD (acme.co.uk, acme.com.au). Without a public-suffix list we can't
 * be exhaustive — this covers the common ones so `acme.co.uk` is refused
 * as an apex while `live.acme.co.uk` is accepted. A miss errs toward
 * accepting an apex, which then simply fails DNS verification.
 */
const SECOND_LEVEL_SLDS = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'or', 'ne', 'go'])

/** Hosts (and parents) customers may never claim: every domain we own + preview infra. */
const RESERVED_SUFFIXES = [...OWN_DOMAINS, 'vercel.app', 'vercel.dev', 'vercel-dns.com', 'localhost']

export type DomainValidation =
  | { ok: true; hostname: string }
  | { ok: false; error: string }

export function validateWorkspaceDomain(
  input: string | null | undefined,
  primaryHosts: readonly string[] = [],
): DomainValidation {
  const hostname = normalizeCustomDomain(input)
  if (!hostname) {
    return { ok: false, error: 'That does not look like a valid hostname. Use something like live.acme.com.' }
  }

  const labels = hostname.split('.')
  const looksApex =
    labels.length < 3 ||
    (labels.length === 3 && labels[2].length === 2 && SECOND_LEVEL_SLDS.has(labels[1]))
  if (looksApex) {
    return {
      ok: false,
      error: 'Use a subdomain such as live.acme.com — root domains (acme.com) are not supported.',
    }
  }

  const reserved = [...RESERVED_SUFFIXES, ...primaryHosts.map(h => h.toLowerCase())]
  if (reserved.some(r => hostname === r || hostname.endsWith(`.${r}`))) {
    return { ok: false, error: 'That domain is reserved. Please use a domain you own.' }
  }

  return { ok: true, hostname }
}

/**
 * Paths a WORKSPACE/PORTAL custom host may serve. Everything else on a
 * non-primary host is a 404 — in particular /dashboard, /api/auth,
 * /admin and /api/workspaces must never be reachable from a
 * customer-branded host, where a look-alike page could phish a session.
 *
 * Host-agnostic on purpose (Edge middleware has no DB): portal domains
 * and workspace domains share one allowlist.
 */
const CUSTOM_HOST_ALLOWED_PREFIXES = [
  '/_next/',
  '/portal',
  '/api/portal',
  // Portal "install into your CRM" flow (app/portal/locations/page.tsx)
  '/api/auth/leadconnector-agency/portal-install',
  // Co-Pilot "no meeting" links + embed button script
  '/copilot/live/',
  '/api/copilot/public/',
  '/copilot.js',
  // Chat/voice widget: loader, iframe pages, API, hosted page
  '/widget.js',
  '/widget/',
  '/api/widget/',
  '/c/',
  // Widget voice (pk-authenticated Gemini Live bridge used by /widget/*/embed)
  '/api/voice/gemini/transcript',
  '/api/voice/gemini/tool',
  // Static assets the pages above reference
  '/favicon',
  '/icon.svg',
  '/apple-icon.png',
  '/manifest.webmanifest',
  '/robots.txt',
  '/opengraph-image',
  '/sw.js',
  '/logo-',
  '/brands/',
  '/images/',
  '/fonts/',
  '/api/health',
]

export function isAllowedOnCustomHost(pathname: string): boolean {
  if (pathname === '/') return true // rewritten to the portal root by middleware
  return CUSTOM_HOST_ALLOWED_PREFIXES.some(p => pathname === p || pathname.startsWith(p))
}

/**
 * Middleware verdict: should this request be 404'd? True only for a
 * NON-primary host asking for a path outside the custom-host allowlist.
 * Primary hosts (incl. app.voxility.ai, widget.xovera.io, previews) are
 * never blocked, whatever the path.
 */
export function isBlockedOnCustomHost(host: string, pathname: string): boolean {
  if (!host || isPrimaryHost(host)) return false
  return !isAllowedOnCustomHost(pathname)
}
