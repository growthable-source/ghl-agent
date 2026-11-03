import { describe, expect, it } from 'vitest'
import { senderAddressFor, sendingDnsRecords, sendingStatusFrom } from './sending-status'

describe('sendingStatusFrom', () => {
  it('maps Resend statuses to ours', () => {
    expect(sendingStatusFrom('verified')).toBe('verified')
    expect(sendingStatusFrom('failed')).toBe('failed')
    expect(sendingStatusFrom('pending')).toBe('pending')
    expect(sendingStatusFrom('not_started')).toBe('pending')
    expect(sendingStatusFrom('temporary_failure')).toBe('pending')
  })
})

describe('sendingDnsRecords', () => {
  it('keeps type/name/value/priority and flags verified records', () => {
    expect(sendingDnsRecords([
      { record: 'SPF', name: 'send.mail', type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, status: 'verified' },
      { record: 'DKIM', name: 'resend._domainkey.mail', type: 'TXT', value: 'p=abc', status: 'pending' },
    ])).toEqual([
      { type: 'MX', name: 'send.mail', value: 'feedback-smtp.us-east-1.amazonses.com', priority: 10, verified: true },
      { type: 'TXT', name: 'resend._domainkey.mail', value: 'p=abc', verified: false },
    ])
  })

  it('handles a missing record list', () => {
    expect(sendingDnsRecords(undefined)).toEqual([])
  })
})

describe('senderAddressFor', () => {
  it('sends from notifications@ on the domain', () => {
    expect(senderAddressFor('mail.acme.com')).toBe('notifications@mail.acme.com')
  })
})
