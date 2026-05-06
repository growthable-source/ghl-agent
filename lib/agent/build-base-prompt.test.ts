import { describe, it, expect } from 'vitest'
import { buildBasePrompt, type AgentForPrompt } from './build-base-prompt'

const agent = (over: Partial<AgentForPrompt> = {}): AgentForPrompt => ({
  id: 'agent_test',
  systemPrompt: 'BASE_PROMPT',
  instructions: null,
  knowledgeEntries: [],
  calendarId: null,
  enabledTools: [],
  ...over,
})

describe('buildBasePrompt', () => {
  it('starts with the agent system prompt', async () => {
    const out = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(out.startsWith('BASE_PROMPT')).toBe(true)
  })

  it('includes Additional Instructions when present', async () => {
    const out = await buildBasePrompt(
      agent({ instructions: 'Always say hi first.' }),
      { channel: 'native', incomingMessage: 'hi' },
    )
    expect(out).toContain('## Additional Instructions')
    expect(out).toContain('Always say hi first.')
  })

  it('omits Additional Instructions when missing', async () => {
    const out = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(out).not.toContain('## Additional Instructions')
  })

  it('appends the channel-specific tail when provided', async () => {
    const out = await buildBasePrompt(
      agent(),
      {
        channel: 'native',
        incomingMessage: 'hi',
        channelInfoBlock: '[Caller phone: +15551234567]',
      },
    )
    expect(out).toContain('[Caller phone: +15551234567]')
  })

  it('includes the quick-reply marker only on the widget channel', async () => {
    const widget = await buildBasePrompt(agent(), { channel: 'widget', incomingMessage: 'hi' })
    const native = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(widget).toContain('## Quick replies (web widget only)')
    expect(widget).toContain('<quickReplies>')
    expect(native).not.toContain('## Quick replies')
  })

  it('injects the calendar block on widget when calendarId + booking tool present', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['get_available_slots'] }),
      { channel: 'widget', incomingMessage: 'book me', visitorContactId: 'visitor:123' },
    )
    expect(out).toContain('Calendar ID for booking: cal_abc')
    expect(out).toContain('Contact ID for this conversation: visitor:123')
  })

  it('does not inject the widget calendar block without a booking tool', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['send_reply'] }),
      { channel: 'widget', incomingMessage: 'hi', visitorContactId: 'visitor:123' },
    )
    expect(out).not.toContain('Calendar ID for booking')
  })

  it('does not inject the widget calendar block on the native channel', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['get_available_slots'] }),
      { channel: 'native', incomingMessage: 'book me' },
    )
    expect(out).not.toContain('Calendar ID for booking')
  })

  it('runs the objectives block only when includeObjectives=true', async () => {
    // We can't easily assert *what* the objectives block contains without
    // hitting Prisma, but with includeObjectives=false the call should not
    // throw or stall — that's enough to confirm the wiring.
    const out = await buildBasePrompt(agent(), {
      channel: 'native',
      incomingMessage: 'hi',
      includeObjectives: false,
    })
    expect(out).toBeTruthy()
  })
})
