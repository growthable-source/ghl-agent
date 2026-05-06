import { describe, it, expect } from 'vitest'
import { executeSandboxTool } from './sandbox'

describe('executeSandboxTool', () => {
  it('returns synthetic contact details for get_contact_details', () => {
    const out = JSON.parse(executeSandboxTool('get_contact_details', { contactId: 'abc' }))
    expect(out.id).toBe('abc')
    expect(out.firstName).toBe('Test')
  })

  it('marks send_reply as not-actually-sent', () => {
    const out = JSON.parse(executeSandboxTool('send_reply', { message: 'hi' }))
    expect(out.success).toBe(true)
    expect(out.note).toMatch(/not actually sent/i)
  })

  it('returns 4 future slot pairs for get_available_slots', () => {
    const out = JSON.parse(executeSandboxTool('get_available_slots', {}))
    expect(Array.isArray(out)).toBe(true)
    expect(out).toHaveLength(4)
    for (const slot of out) {
      const start = new Date(slot.startTime).getTime()
      const end = new Date(slot.endTime).getTime()
      expect(end).toBeGreaterThan(start)
      expect(start).toBeGreaterThan(Date.now())
    }
  })

  it('echoes the score and reason for score_lead', () => {
    const out = JSON.parse(executeSandboxTool('score_lead', { score: 75, reason: 'engaged' }))
    expect(out.success).toBe(true)
    expect(out.note).toContain('75')
    expect(out.note).toContain('engaged')
  })

  it('falls through with a generic note for an unknown tool', () => {
    const out = JSON.parse(executeSandboxTool('made_up_tool', {}))
    expect(out.note).toMatch(/made_up_tool/)
    expect(out.note).toMatch(/Sandbox/)
  })
})
