import { describe, it, expect, vi, beforeEach } from 'vitest'

const executeToolMock = vi.fn(async () => 'OK')
vi.mock('@/lib/agent/execute-tool', () => ({ executeTool: (...a: any[]) => executeToolMock(...a) }))

const searchContactsMock = vi.fn()
vi.mock('@/lib/crm-client', () => ({ searchContacts: (...a: any[]) => searchContactsMock(...a) }))

import { runVoiceAgentTool } from './voice-tool-context'

describe('runVoiceAgentTool', () => {
  beforeEach(() => { executeToolMock.mockClear(); searchContactsMock.mockReset() })

  it('injects agent.calendarId and resolves the caller contactId for book_appointment', async () => {
    searchContactsMock.mockResolvedValue([{ id: 'C_CALLER', phone: '+15551230000' }])
    await runVoiceAgentTool({
      name: 'book_appointment',
      params: { startTime: '2026-07-01T10:00:00-04:00' },
      agentId: 'a1', locationId: 'loc1', workspaceId: 'ws1',
      callerPhone: '+15551230000', calendarId: 'CAL_AGENT',
    })
    const call = executeToolMock.mock.calls[0]
    const [toolName, input, locationId, , , channel] = call
    expect(toolName).toBe('book_appointment')
    expect(input.calendarId).toBe('CAL_AGENT')   // injected
    expect(locationId).toBe('loc1')
    expect(channel).toBe('voice')
    expect(call[11]).toBe('ws1')                 // param 12 workspaceId
    expect(call[12]).toBe('C_CALLER')            // param 13 caller contactId
  })

  it('does not overwrite a model-supplied calendarId', async () => {
    searchContactsMock.mockResolvedValue([])
    await runVoiceAgentTool({
      name: 'book_appointment',
      params: { startTime: '2026-07-01T10:00:00-04:00', calendarId: 'CAL_MODEL' },
      agentId: 'a1', locationId: 'loc1', workspaceId: 'ws1',
      callerPhone: '', calendarId: 'CAL_AGENT',
    })
    expect(executeToolMock.mock.calls[0][1].calendarId).toBe('CAL_MODEL')
  })

  it('injects calendarId + a derived window into get_available_slots', async () => {
    searchContactsMock.mockResolvedValue([])
    await runVoiceAgentTool({
      name: 'get_available_slots',
      params: { date: '2026-07-01' },
      agentId: 'a1', locationId: 'loc1', workspaceId: 'ws1',
      callerPhone: '', calendarId: 'CAL_AGENT',
    })
    const input = executeToolMock.mock.calls[0][1]
    expect(input.calendarId).toBe('CAL_AGENT')
    expect(input.startDate).toBe('2026-07-01')
    expect(typeof input.endDate).toBe('string')
  })

  it('does not inject a calendar for non-calendar tools like upsert_contact', async () => {
    searchContactsMock.mockResolvedValue([{ id: 'C', phone: '+1' }])
    await runVoiceAgentTool({
      name: 'upsert_contact',
      params: { firstName: 'Jo', email: 'jo@x.com' },
      agentId: 'a1', locationId: 'loc1', workspaceId: 'ws1',
      callerPhone: '+1', calendarId: null,
    })
    expect(executeToolMock.mock.calls[0][1].calendarId).toBeUndefined()
  })

  it('tolerates a failing contact lookup (unknown caller -> undefined context)', async () => {
    searchContactsMock.mockRejectedValue(new Error('crm down'))
    await runVoiceAgentTool({
      name: 'book_appointment',
      params: { startTime: '2026-07-01T10:00:00-04:00' },
      agentId: 'a1', locationId: 'loc1', workspaceId: 'ws1',
      callerPhone: '+1', calendarId: 'CAL_AGENT',
    })
    expect(executeToolMock.mock.calls[0][12]).toBeUndefined()
  })
})
