import { describe, it, expect } from 'vitest'
import { firstResponseMins, resolutionMins, attainment } from './sla'

const t0 = new Date('2026-06-01T00:00:00Z')
const mins = (n: number) => new Date(t0.getTime() + n * 60000)

describe('sla measurement', () => {
  it('first response = first outbound message minus created', () => {
    const ticket = {
      createdAt: t0,
      messages: [
        { direction: 'inbound', createdAt: mins(1) },
        { direction: 'outbound', createdAt: mins(30) },
        { direction: 'outbound', createdAt: mins(90) },
      ],
      assignedAt: mins(10),
    }
    expect(firstResponseMins(ticket)).toBe(30)
  })

  it('first response falls back to assignedAt when no outbound yet', () => {
    const ticket = { createdAt: t0, messages: [{ direction: 'inbound', createdAt: mins(5) }], assignedAt: mins(20) }
    expect(firstResponseMins(ticket)).toBe(20)
  })

  it('first response is null when neither outbound nor assignment', () => {
    expect(firstResponseMins({ createdAt: t0, messages: [], assignedAt: null })).toBeNull()
  })

  it('resolution = closedAt minus created, null if not closed', () => {
    expect(resolutionMins({ createdAt: t0, closedAt: mins(120) })).toBe(120)
    expect(resolutionMins({ createdAt: t0, closedAt: null })).toBeNull()
  })

  it('attainment = % at or under target, null when no measurable items', () => {
    expect(attainment([30, 50, 90], 60)).toBe(67) // 2 of 3 <= 60 → 66.7 → 67
    expect(attainment([], 60)).toBeNull()
    expect(attainment([10, 20], null)).toBeNull() // no target → not tracked
  })
})
