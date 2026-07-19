import { describe, it, expect } from 'vitest'
import {
  ALLOWED_TRANSITIONS,
  canTransition,
  getPurchase,
  mergePurchaseMetadata,
  projectPurchase,
  type PurchaseMetadata,
} from './state'

describe('canTransition / ALLOWED_TRANSITIONS', () => {
  it('allows the documented happy-path chain', () => {
    expect(canTransition('checkout_started', 'paid')).toBe(true)
    expect(canTransition('paid', 'account_ready')).toBe(true)
    expect(canTransition('account_ready', 'claimed')).toBe(true)
    expect(canTransition('claimed', 'crm_provisioning')).toBe(true)
    expect(canTransition('crm_provisioning', 'crm_ready')).toBe(true)
    expect(canTransition('crm_provisioning', 'crm_failed')).toBe(true)
    expect(canTransition('crm_ready', 'number_purchasing')).toBe(true)
    expect(canTransition('crm_failed', 'number_deferred')).toBe(true)
    expect(canTransition('number_purchasing', 'number_purchased')).toBe(true)
    expect(canTransition('number_purchasing', 'number_failed')).toBe(true)
    expect(canTransition('number_purchasing', 'number_deferred')).toBe(true)
    expect(canTransition('number_purchased', 'complete')).toBe(true)
    expect(canTransition('number_failed', 'complete')).toBe(true)
    expect(canTransition('number_deferred', 'complete')).toBe(true)
  })

  it('rejects skipping stages', () => {
    expect(canTransition('checkout_started', 'account_ready')).toBe(false)
    expect(canTransition('paid', 'claimed')).toBe(false)
    expect(canTransition('claimed', 'crm_ready')).toBe(false)
  })

  it('rejects moving backwards', () => {
    expect(canTransition('paid', 'checkout_started')).toBe(false)
    expect(canTransition('complete', 'number_purchased')).toBe(false)
  })

  it('complete is terminal', () => {
    expect(ALLOWED_TRANSITIONS.complete).toEqual([])
  })

  it('every state referenced as a "to" is a valid key in the table', () => {
    const states = Object.keys(ALLOWED_TRANSITIONS)
    for (const [, tos] of Object.entries(ALLOWED_TRANSITIONS)) {
      for (const to of tos) {
        expect(states).toContain(to)
      }
    }
  })
})

describe('getPurchase', () => {
  it('returns null for missing/malformed metadata', () => {
    expect(getPurchase(null)).toBeNull()
    expect(getPurchase(undefined)).toBeNull()
    expect(getPurchase('not an object')).toBeNull()
    expect(getPurchase([1, 2, 3])).toBeNull()
    expect(getPurchase({})).toBeNull()
    expect(getPurchase({ purchase: 'not an object' })).toBeNull()
  })

  it('reads the purchase sub-object when present', () => {
    const purchase = getPurchase({ someProspectingKey: 'x', purchase: { state: 'paid', period: 'monthly' } })
    expect(purchase).toEqual({ state: 'paid', period: 'monthly' })
  })
})

describe('mergePurchaseMetadata', () => {
  it('preserves prospecting-tool metadata keys untouched', () => {
    const existing = { campaignId: 'abc123', vertical: 'plumbing', purchase: { state: 'checkout_started', period: 'monthly', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }
    const merged = mergePurchaseMetadata(existing, { state: 'paid' })
    expect(merged.campaignId).toBe('abc123')
    expect(merged.vertical).toBe('plumbing')
  })

  it('shallow-merges the purchase object, keeping untouched fields', () => {
    const existing = { purchase: { state: 'checkout_started', period: 'monthly', contactEmail: 'a@b.com', startedAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' } }
    const merged = mergePurchaseMetadata(existing, { state: 'paid' })
    const purchase = merged.purchase as PurchaseMetadata
    expect(purchase.state).toBe('paid')
    expect(purchase.contactEmail).toBe('a@b.com') // untouched field survives
    expect(purchase.period).toBe('monthly')
  })

  it('initializes purchase from scratch when metadata has none yet', () => {
    const merged = mergePurchaseMetadata(null, { state: 'checkout_started', period: 'annual' })
    const purchase = merged.purchase as PurchaseMetadata
    expect(purchase.state).toBe('checkout_started')
    expect(purchase.period).toBe('annual')
  })

  it('always stamps a fresh updatedAt', () => {
    const merged = mergePurchaseMetadata({ purchase: { state: 'paid', updatedAt: '2020-01-01T00:00:00.000Z' } }, { state: 'account_ready' })
    const purchase = merged.purchase as PurchaseMetadata
    expect(purchase.updatedAt).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('does not mutate the input object', () => {
    const existing = { keepMe: true, purchase: { state: 'paid' } }
    const merged = mergePurchaseMetadata(existing, { state: 'account_ready' })
    expect(existing.purchase.state).toBe('paid') // original untouched
    expect(merged).not.toBe(existing)
  })
})

describe('projectPurchase — public projection redaction', () => {
  const fullPurchase: PurchaseMetadata = {
    state: 'crm_provisioning',
    period: 'monthly',
    contactEmail: 'buyer@example.com',
    contactName: 'Buyer Name',
    startedAt: '2026-01-01T00:00:00.000Z',
    paidAt: '2026-01-01T00:05:00.000Z',
    stripeSessionId: 'cs_test_123',
    stripeCustomerId: 'cus_123',
    stripeSubscriptionId: 'sub_123',
    userId: 'user_123',
    workspaceId: 'ws_123',
    locationId: 'loc_123',
    phoneNumber: null,
    concierge: null,
    updatedAt: '2026-01-01T00:05:00.000Z',
  }

  it('returns null for no purchase', () => {
    expect(projectPurchase(null)).toBeNull()
    expect(projectPurchase(undefined)).toBeNull()
  })

  it('never leaks email, name, stripe ids, or internal ids', () => {
    const projection = projectPurchase(fullPurchase) as unknown as Record<string, unknown>
    expect(projection.contactEmail).toBeUndefined()
    expect(projection.contactName).toBeUndefined()
    expect(projection.stripeSessionId).toBeUndefined()
    expect(projection.stripeCustomerId).toBeUndefined()
    expect(projection.stripeSubscriptionId).toBeUndefined()
    expect(projection.userId).toBeUndefined()
    expect(projection.workspaceId).toBeUndefined()
    expect(projection.locationId).toBeUndefined()
  })

  it('exposes only state, period, and a concierge boolean by default', () => {
    const projection = projectPurchase(fullPurchase)
    expect(projection).toEqual({ state: 'crm_provisioning', period: 'monthly', concierge: false, phoneNumber: null })
  })

  it('surfaces concierge as a boolean, not the raw flag object', () => {
    const projection = projectPurchase({
      ...fullPurchase,
      concierge: { stage: 'leadconnector', reason: 'not_configured', flaggedAt: '2026-01-01T00:10:00.000Z' },
    })
    expect(projection?.concierge).toBe(true)
    expect((projection as unknown as Record<string, unknown>).reason).toBeUndefined()
  })

  it('only surfaces phoneNumber once state is number_purchased', () => {
    const notYet = projectPurchase({ ...fullPurchase, state: 'number_purchasing', phoneNumber: '+15551234567' })
    expect(notYet?.phoneNumber).toBeNull()

    const purchased = projectPurchase({ ...fullPurchase, state: 'number_purchased', phoneNumber: '+15551234567' })
    expect(purchased?.phoneNumber).toBe('+15551234567')
  })
})
