import { describe, it, expect } from 'vitest'
import { estimateWaitSecs } from './queue-estimate'

describe('estimateWaitSecs', () => {
  it('position 1 with capacity 1 = one handle cycle', () => {
    expect(estimateWaitSecs(1, 1, 240)).toBe(240)
  })
  it('scales by ceil(position / capacity)', () => {
    expect(estimateWaitSecs(3, 2, 200)).toBe(400) // ceil(3/2)=2 cycles
    expect(estimateWaitSecs(4, 2, 200)).toBe(400) // ceil(4/2)=2 cycles
    expect(estimateWaitSecs(5, 2, 200)).toBe(600) // ceil(5/2)=3 cycles
  })
  it('returns 0 for non-positive position or no handle-time data', () => {
    expect(estimateWaitSecs(0, 3, 240)).toBe(0)
    expect(estimateWaitSecs(2, 3, 0)).toBe(0)
  })
  it('treats a junk capacity as 1', () => {
    expect(estimateWaitSecs(2, 0, 100)).toBe(200)
  })
})
