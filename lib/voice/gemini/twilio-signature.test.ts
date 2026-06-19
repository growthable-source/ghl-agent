import { describe, it, expect } from 'vitest'
import { computeTwilioSignature, validateTwilioSignature } from './twilio-signature'

// Twilio's canonical worked example, verbatim from their security docs
// (https://www.twilio.com/docs/usage/security).
const AUTH_TOKEN = '12345'
const URL = 'https://example.com/myapp.php?foo=1&bar=2'
const PARAMS = {
  CallSid: 'CA1234567890ABCDE',
  Caller: '+14158675310',
  Digits: '1234',
  From: '+14158675310',
  To: '+18005551212',
}
const EXPECTED = 'L/OH5YylLD5NRKLltdqwSvS0BnU='

describe('computeTwilioSignature', () => {
  it('matches Twilio reference vector', () => {
    expect(computeTwilioSignature(AUTH_TOKEN, URL, PARAMS)).toBe(EXPECTED)
  })
})

describe('validateTwilioSignature', () => {
  it('accepts the correct signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, EXPECTED)).toBe(true)
  })
  it('rejects a wrong signature', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, 'wrong')).toBe(false)
    expect(validateTwilioSignature(AUTH_TOKEN, URL, PARAMS, '')).toBe(false)
  })
  it('rejects when a param is tampered', () => {
    expect(validateTwilioSignature(AUTH_TOKEN, URL, { ...PARAMS, Digits: '9999' }, EXPECTED)).toBe(false)
  })
})
