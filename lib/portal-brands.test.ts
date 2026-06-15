import { describe, it, expect } from 'vitest'
import { filterToAllowedBrands } from './portal-brands'

describe('filterToAllowedBrands', () => {
  it('keeps only IDs present in the allowed set', () => {
    expect(filterToAllowedBrands(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['a', 'c'])
  })
  it('dedupes repeated IDs', () => {
    expect(filterToAllowedBrands(['a', 'a', 'b'], new Set(['a', 'b']))).toEqual(['a', 'b'])
  })
  it('returns empty when nothing is allowed', () => {
    expect(filterToAllowedBrands(['a', 'b'], new Set())).toEqual([])
  })
  it('returns empty for empty input', () => {
    expect(filterToAllowedBrands([], new Set(['a']))).toEqual([])
  })
})
