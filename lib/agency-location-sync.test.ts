import { describe, it, expect } from 'vitest'
import { planAgencyLocationSync, type FetchedAgencyLocation } from './agency-location-sync'

const fetched = (id: string, name = `Loc ${id}`): FetchedAgencyLocation => ({
  locationId: id, name, city: null, state: null, country: null, email: null, phone: null,
})

describe('planAgencyLocationSync', () => {
  it('upserts every fetched location', () => {
    const plan = planAgencyLocationSync([], [fetched('a'), fetched('b')])
    expect(plan.upserts.map(u => u.locationId)).toEqual(['a', 'b'])
    expect(plan.markRemoved).toEqual([])
  })

  it('marks locations missing from the fetch as removed', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'a', removedAt: null }, { locationId: 'b', removedAt: null }],
      [fetched('a')],
    )
    expect(plan.markRemoved).toEqual(['b'])
  })

  it('does not re-mark already-removed locations', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'b', removedAt: new Date('2026-01-01') }],
      [],
    )
    expect(plan.markRemoved).toEqual([])
  })

  it('a reappearing location is upserted (restore is the upsert clearing removedAt)', () => {
    const plan = planAgencyLocationSync(
      [{ locationId: 'a', removedAt: new Date('2026-01-01') }],
      [fetched('a')],
    )
    expect(plan.upserts.map(u => u.locationId)).toEqual(['a'])
    expect(plan.markRemoved).toEqual([])
  })

  it('dedupes fetched locations by locationId (defensive against API pagination overlap)', () => {
    const plan = planAgencyLocationSync([], [fetched('a', 'First'), fetched('a', 'Second')])
    expect(plan.upserts).toHaveLength(1)
    expect(plan.upserts[0].name).toBe('First')
  })
})
