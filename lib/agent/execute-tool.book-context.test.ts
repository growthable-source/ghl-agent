import { describe, it, expect, vi } from 'vitest'
import { executeTool } from './execute-tool'

// book_appointment must use input.contactId when the model supplies it
// (text agents always do) and fall back to the caller-contact CONTEXT
// (positional param 13) when it doesn't — the voice / unknown-caller case.
function fakeAdapter(calls: any[]) {
  return {
    locationId: 'loc1',
    bookAppointment: vi.fn(async (p: any) => { calls.push(p); return { id: 'appt_1' } }),
    getCalendarTimezone: vi.fn(async () => 'America/New_York'),
  } as any
}

describe('book_appointment contactId fallback', () => {
  it('uses input.contactId when present', async () => {
    const calls: any[] = []
    const adapter = fakeAdapter(calls)
    await executeTool(
      'book_appointment',
      { calendarId: 'cal1', contactId: 'C_INPUT', startTime: '2026-07-01T10:00:00-04:00' },
      'loc1', false, undefined, 'voice', undefined, adapter,
      undefined, undefined, undefined, 'ws1', 'C_CONTEXT',
    )
    expect(calls[0].contactId).toBe('C_INPUT')
  })

  it('falls back to the context contactId when input omits it', async () => {
    const calls: any[] = []
    const adapter = fakeAdapter(calls)
    await executeTool(
      'book_appointment',
      { calendarId: 'cal1', startTime: '2026-07-01T10:00:00-04:00' },
      'loc1', false, undefined, 'voice', undefined, adapter,
      undefined, undefined, undefined, 'ws1', 'C_CONTEXT',
    )
    expect(calls[0].contactId).toBe('C_CONTEXT')
  })

  it('returns an actionable error when there is no contact at all (capture first)', async () => {
    const calls: any[] = []
    const adapter = fakeAdapter(calls)
    const out = await executeTool(
      'book_appointment',
      { calendarId: 'cal1', startTime: '2026-07-01T10:00:00-04:00' },
      'loc1', false, undefined, 'voice', undefined, adapter,
      undefined, undefined, undefined, 'ws1', undefined,
    )
    expect(calls.length).toBe(0)
    const parsed = JSON.parse(out)
    expect(parsed.success).toBe(false)
    expect(String(parsed.hint ?? parsed.error)).toMatch(/upsert_contact|create_contact|capture/i)
  })
})
