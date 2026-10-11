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
