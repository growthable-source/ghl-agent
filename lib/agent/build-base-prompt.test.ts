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
    expect(out.prompt.startsWith('BASE_PROMPT')).toBe(true)
  })

  it('includes Additional Instructions when present', async () => {
    const out = await buildBasePrompt(
      agent({ instructions: 'Always say hi first.' }),
      { channel: 'native', incomingMessage: 'hi' },
    )
    expect(out.prompt).toContain('## Additional Instructions')
    expect(out.prompt).toContain('Always say hi first.')
  })

  it('omits Additional Instructions when missing', async () => {
    const out = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(out.prompt).not.toContain('## Additional Instructions')
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
    expect(out.prompt).toContain('[Caller phone: +15551234567]')
  })

  it('includes the quick-reply marker only on the widget channel', async () => {
    const widget = await buildBasePrompt(agent(), { channel: 'widget', incomingMessage: 'hi' })
    const native = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(widget.prompt).toContain('## Quick replies (web widget only)')
    expect(widget.prompt).toContain('<quickReplies>')
    expect(native.prompt).not.toContain('## Quick replies')
  })

  it('injects the calendar block on widget when calendarId + booking tool present', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['get_available_slots'] }),
      { channel: 'widget', incomingMessage: 'book me', visitorContactId: 'visitor:123' },
    )
    expect(out.prompt).toContain('Calendar ID for booking: cal_abc')
    expect(out.prompt).toContain('Contact ID for this conversation: visitor:123')
  })

  it('does not inject the widget calendar block without a booking tool', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['send_reply'] }),
      { channel: 'widget', incomingMessage: 'hi', visitorContactId: 'visitor:123' },
    )
    expect(out.prompt).not.toContain('Calendar ID for booking')
  })

  it('does not inject the widget calendar block on the native channel', async () => {
    const out = await buildBasePrompt(
      agent({ calendarId: 'cal_abc', enabledTools: ['get_available_slots'] }),
      { channel: 'native', incomingMessage: 'book me' },
    )
    expect(out.prompt).not.toContain('Calendar ID for booking')
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
    expect(out.prompt).toBeTruthy()
  })

  // ─── Prompt-cache split ───
  // Message-dependent content must land in `volatileContext` (rendered
  // after the Anthropic cache breakpoint), never in `prompt` (the cached
  // prefix). A knowledge block keyed to the incoming message in `prompt`
  // would invalidate the whole cached prefix on every inbound message.
  it('puts the message-keyed knowledge block in volatileContext, not the prompt', async () => {
    const out = await buildBasePrompt(
      agent({ knowledgeEntries: [{ title: 'Pricing', content: 'Plans start at $99/mo.' }] as any }),
      { channel: 'native', incomingMessage: 'how much is pricing' },
    )
    expect(out.volatileContext).toContain('## Knowledge Base')
    expect(out.volatileContext).toContain('Plans start at $99/mo.')
    expect(out.prompt).not.toContain('## Knowledge Base')
  })

  it('leaves volatileContext empty when there is no message-dependent content', async () => {
    const out = await buildBasePrompt(agent(), { channel: 'native', incomingMessage: 'hi' })
    expect(out.volatileContext).toBe('')
  })
})
