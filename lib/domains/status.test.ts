import { describe, expect, it } from 'vitest'
import { deriveDomainState } from './status'

describe('deriveDomainState', () => {
  it('is active only when verified and correctly pointed', () => {
    expect(deriveDomainState({ hostname: 'live.a.com', verified: true, misconfigured: false, verification: [] }))
      .toEqual({ status: 'active', dnsRecords: [] })
  })
  it('asks for the CNAME when misconfigured', () => {
    const r = deriveDomainState({ hostname: 'live.a.com', verified: true, misconfigured: true, verification: [] })
    expect(r.status).toBe('pending')
    expect(r.dnsRecords).toEqual([{ type: 'CNAME', name: 'live.a.com', value: 'cname.vercel-dns.com' }])
  })
  it('adds the TXT challenge when ownership is unverified', () => {
    const r = deriveDomainState({
      hostname: 'live.a.com', verified: false, misconfigured: true,
      verification: [{ type: 'TXT', domain: '_vercel.a.com', value: 'vc-domain-verify=x', reason: 'pending_domain_verification' }],
    })
    expect(r.dnsRecords.map(x => x.type)).toEqual(['CNAME', 'TXT'])
  })
  it('never returns an empty record list while pending', () => {
    const r = deriveDomainState({ hostname: 'live.a.com', verified: false, misconfigured: false, verification: [] })
    expect(r.dnsRecords).toHaveLength(1)
  })
  it('honours a custom CNAME target', () => {
    const r = deriveDomainState({ hostname: 'h.a.com', verified: true, misconfigured: true, verification: [], cnameTarget: 'x.example' })
    expect(r.dnsRecords[0].value).toBe('x.example')
  })
})
