import { describe, it, expect, vi } from 'vitest'
import { evaluateReferences } from './check'

describe('evaluateReferences', () => {
  const healthyValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockResolvedValue(null) }
  const brokenValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockResolvedValue('not found') }
  const transientValidator = { label: 'X', dependentTools: [], fetch: vi.fn().mockRejectedValue(new Error('timeout')) }

  it('marks a reference healthy when validator returns null', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('healthy')
    expect(result[0].lastError).toBeNull()
  })

  it('marks a reference broken when validator returns a string', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: brokenValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('broken')
    expect(result[0].lastError).toBe('not found')
  })

  it('preserves the previous status when validator throws transiently', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: transientValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('healthy')
    expect(result[0].rawStatus).toBe('transient_error')
    expect(result[0].lastError).toContain('timeout')
  })

  it('marks transient as transient_error when no previous status exists', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: transientValidator },
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result[0].writeStatus).toBe('transient_error')
  })

  it('skips references with no registered validator', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'unknown', resourceId: '1', sourceField: 'f' }],
      validators: {},
      previousStatusByKey: new Map(),
      adapter: {} as any,
    })
    expect(result).toEqual([])
  })

  it('flags transitions from healthy to broken', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: brokenValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBe('healthy_to_broken')
  })

  it('flags transitions from broken to healthy', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map([['x:1:f', 'broken']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBe('broken_to_healthy')
  })

  it('returns null transition when status unchanged', async () => {
    const result = await evaluateReferences({
      refs: [{ resourceType: 'x', resourceId: '1', sourceField: 'f' }],
      validators: { x: healthyValidator },
      previousStatusByKey: new Map([['x:1:f', 'healthy']]),
      adapter: {} as any,
    })
    expect(result[0].transition).toBeNull()
  })
})
