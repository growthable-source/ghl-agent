/**
 * Pure: turn Vercel's view of a domain into our status + the DNS records
 * the customer must (still) create. Kept separate from the DB/fetch layer
 * so the rules are unit-tested.
 */

import type { VercelVerificationRecord } from './vercel'

export const DEFAULT_CNAME_TARGET = 'cname.vercel-dns.com'

export interface DnsRecord {
  type: string
  /** Full hostname the record belongs on (the customer's DNS UI may want only the left-most label). */
  name: string
  value: string
  reason?: string
}

export type DomainStatus = 'pending' | 'active'

export function deriveDomainState(input: {
  hostname: string
  verified: boolean
  misconfigured: boolean
  verification: VercelVerificationRecord[]
  cnameTarget?: string
}): { status: DomainStatus; dnsRecords: DnsRecord[] } {
  const { hostname, verified, misconfigured, verification } = input
  const cname = input.cnameTarget || DEFAULT_CNAME_TARGET

  if (verified && !misconfigured) return { status: 'active', dnsRecords: [] }

  const records: DnsRecord[] = []
  if (misconfigured) records.push({ type: 'CNAME', name: hostname, value: cname })
  if (!verified) {
    // Only needed when the hostname is claimed by another Vercel account.
    for (const v of verification) {
      records.push({ type: v.type, name: v.domain, value: v.value, reason: v.reason })
    }
  }
  // Verified-but-misconfigured is covered by the CNAME above; the
  // unverified-with-no-challenge case (fresh add) also needs the CNAME.
  if (!records.length) records.push({ type: 'CNAME', name: hostname, value: cname })
  return { status: 'pending', dnsRecords: records }
}

/**
 * Host gate decision. `owner` = who registered the request host as a
 * workspace domain (null = nobody: runtime projects, proxies, portal
 * domains). Unknown hosts pass; a registered host passes only for its own
 * workspace and only while it is actually serving.
 */
export function hostAccess(owner: { workspaceId: string; serving: boolean } | null, workspaceId: string): boolean {
  if (!owner) return true
  return owner.serving && owner.workspaceId === workspaceId
}

/** Pending domains that never resolve are marked 'error' after this long (counted from pendingSince). */
export const PENDING_GIVE_UP_MS = 7 * 86_400_000
/** An ACTIVE domain is only demoted after this many consecutive failed checks (one flaky API response must not take it down). */
export const DEMOTE_AFTER_FAILED_CHECKS = 2

export interface DomainLifecycle {
  status: string
  pendingSince: Date | null
  failedChecks: number
}

/**
 * Pure transition for one successful read of Vercel's state.
 *   - derived active           → active, counters reset
 *   - active + derived pending → stay active until DEMOTE_AFTER_FAILED_CHECKS
 *     consecutive failures, then demote and start the pending clock
 *   - not-active + pending     → pending, until pendingSince is older than
 *     PENDING_GIVE_UP_MS, then 'error' (still polled, just less often — see
 *     the cron — and it goes active the moment DNS resolves)
 * `keepRecords` = leave the stored dnsRecords alone (still active).
 */
export function nextLifecycle(
  prev: DomainLifecycle,
  derived: DomainStatus,
  now: Date,
): DomainLifecycle & { lastError: string | null; keepRecords: boolean } {
  if (derived === 'active') {
    return { status: 'active', pendingSince: null, failedChecks: 0, lastError: null, keepRecords: false }
  }
  if (prev.status === 'active') {
    const failed = prev.failedChecks + 1
    if (failed < DEMOTE_AFTER_FAILED_CHECKS) {
      return { status: 'active', pendingSince: null, failedChecks: failed, lastError: null, keepRecords: true }
    }
    return { status: 'pending', pendingSince: now, failedChecks: 0, lastError: null, keepRecords: false }
  }
  const since = prev.pendingSince ?? now
  const gaveUp = now.getTime() - since.getTime() > PENDING_GIVE_UP_MS
  return {
    status: gaveUp ? 'error' : 'pending',
    pendingSince: since,
    failedChecks: 0,
    lastError: gaveUp ? 'DNS has not been detected for over 7 days. Check the records below; we keep checking daily.' : null,
    keepRecords: false,
  }
}
