/**
 * Pure: turn Resend's view of a sending domain into our status + the DNS
 * records to show the customer, and build the sender address. Kept apart
 * from the fetch/DB layer so the rules are unit-tested.
 */

import type { ResendDnsRecord } from './resend-domains'

export type SendingDomainStatus = 'pending' | 'verified' | 'failed'

export interface SendingDnsRecord {
  type: string
  /** As Resend gives it — relative to the customer's root domain zone. */
  name: string
  value: string
  priority?: number
  /** True once Resend has seen this record. */
  verified: boolean
}

/** 'temporary_failure' is a DNS hiccup on Resend's side — keep waiting. */
export function sendingStatusFrom(resendStatus: string): SendingDomainStatus {
  if (resendStatus === 'verified') return 'verified'
  if (resendStatus === 'failed') return 'failed'
  return 'pending'
}

export function sendingDnsRecords(records: ResendDnsRecord[] | undefined): SendingDnsRecord[] {
  return (records ?? []).map(r => ({
    type: r.type,
    name: r.name,
    value: r.value,
    ...(typeof r.priority === 'number' ? { priority: r.priority } : {}),
    verified: r.status === 'verified',
  }))
}

/** Address white-label emails send from once the domain is verified. */
export function senderAddressFor(domain: string): string {
  return `notifications@${domain}`
}
