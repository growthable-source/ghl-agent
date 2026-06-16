import { describe, it, expect } from 'vitest'
import { costUsd, baselineCostUsd } from './pricing'

describe('costUsd', () => {
  it('prices Sonnet at $3/$15 per 1M', () => {
    expect(costUsd('claude-sonnet', 1_000_000, 1_000_000)).toBeCloseTo(18, 6)
  })

  it('prices DeepSeek V4-Flash far cheaper', () => {
    expect(costUsd('deepseek-flash', 1_000_000, 1_000_000)).toBeCloseTo(0.42, 6)
  })

  it('falls back to the baseline price for an unknown model', () => {
    expect(costUsd('mystery-model', 1_000_000, 0)).toBeCloseTo(3, 6)
  })

  it('scales linearly with token counts', () => {
    expect(costUsd('claude-haiku', 500_000, 200_000)).toBeCloseTo(0.5 * 1 + 0.2 * 5, 6)
  })
})

describe('baselineCostUsd', () => {
  it('always prices at the Sonnet baseline', () => {
    expect(baselineCostUsd(1_000_000, 1_000_000)).toBeCloseTo(18, 6)
  })

  it('shows the saving when actual ran on DeepSeek', () => {
    const tokens: [number, number] = [2_000_000, 1_000_000]
    const actual = costUsd('deepseek-flash', ...tokens)
    const baseline = baselineCostUsd(...tokens)
    expect(baseline - actual).toBeGreaterThan(0)
    expect(baseline).toBeCloseTo(2 * 3 + 1 * 15, 6) // 21
  })
})
