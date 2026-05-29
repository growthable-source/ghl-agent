import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { getLocationDashboardUrl } from './leadconnector-dashboard-url'

describe('getLocationDashboardUrl', () => {
  const originalEnv = process.env.LEADCONNECTOR_DASHBOARD_BASE_URL

  beforeEach(() => {
    delete process.env.LEADCONNECTOR_DASHBOARD_BASE_URL
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.LEADCONNECTOR_DASHBOARD_BASE_URL
    else process.env.LEADCONNECTOR_DASHBOARD_BASE_URL = originalEnv
  })

  it('builds the canonical /v2/location/<id> URL on the Voxility default', () => {
    expect(getLocationDashboardUrl('RgbqCi123abc', 'ghl'))
      .toBe('https://app.voxility.ai/v2/location/RgbqCi123abc')
  })

  it('respects LEADCONNECTOR_DASHBOARD_BASE_URL for whitelabel overrides', () => {
    process.env.LEADCONNECTOR_DASHBOARD_BASE_URL = 'https://app.acmeagency.com'
    expect(getLocationDashboardUrl('xyz', 'ghl'))
      .toBe('https://app.acmeagency.com/v2/location/xyz')
  })

  it('strips trailing slashes off the configured base', () => {
    process.env.LEADCONNECTOR_DASHBOARD_BASE_URL = 'https://app.acmeagency.com//'
    expect(getLocationDashboardUrl('xyz', 'ghl'))
      .toBe('https://app.acmeagency.com/v2/location/xyz')
  })

  it('returns null for native: locations (no external dashboard exists)', () => {
    expect(getLocationDashboardUrl('native:ws_abc', 'native')).toBeNull()
  })

  it('returns null for placeholder: locations', () => {
    expect(getLocationDashboardUrl('placeholder:ws_abc', 'none')).toBeNull()
  })

  it('returns null for hubspot — HubSpot uses a different URL shape', () => {
    expect(getLocationDashboardUrl('123', 'hubspot')).toBeNull()
  })

  it('returns null for empty/missing locationId', () => {
    expect(getLocationDashboardUrl('', 'ghl')).toBeNull()
  })

  it('URL-encodes the locationId so weird characters do not break the link', () => {
    expect(getLocationDashboardUrl('a/b?c', 'ghl'))
      .toBe('https://app.voxility.ai/v2/location/a%2Fb%3Fc')
  })

  it('defaults provider to ghl when omitted', () => {
    expect(getLocationDashboardUrl('xyz')).toBe('https://app.voxility.ai/v2/location/xyz')
  })
})
