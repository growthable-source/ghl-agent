import { describe, it, expect } from 'vitest'
import { frameDiffScore, CHANGE_THRESHOLD } from './frame-capture'

describe('frameDiffScore', () => {
  it('returns 0 for identical frames', () => {
    const frame = [10, 20, 30, 40]
    expect(frameDiffScore(frame, frame)).toBe(0)
  })

  it('returns the mean absolute difference', () => {
    expect(frameDiffScore([0, 0], [10, 30])).toBe(20)
  })

  it('treats length mismatch and empty input as maximal change', () => {
    expect(frameDiffScore([], [])).toBe(255)
    expect(frameDiffScore([1, 2], [1])).toBe(255)
  })

  it('cursor-level noise stays under the change threshold', () => {
    // One pixel of a 576-pixel thumbnail shifting by 100 gray levels —
    // roughly what a cursor move produces.
    const a = new Array(576).fill(128)
    const b = [...a]
    b[40] = 228
    expect(frameDiffScore(a, b)).toBeLessThan(CHANGE_THRESHOLD)
  })

  it('a page navigation crosses the change threshold', () => {
    // Half the thumbnail flipping from light to dark.
    const a = new Array(576).fill(220)
    const b = a.map((v, i) => (i < 288 ? 40 : v))
    expect(frameDiffScore(a, b)).toBeGreaterThan(CHANGE_THRESHOLD)
  })
})
