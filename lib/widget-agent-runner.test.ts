import { describe, it, expect } from 'vitest'
import { shouldAgentReply } from './widget-agent-runner'

/**
 * Regression coverage for the AI handoff gate (QA bug #7:
 * "even when status is set to 'Taken Over,' the AI still sends
 * responses"). Two state machines can each pause the AI; both must
 * silence it, neither in isolation is sufficient.
 */
describe('shouldAgentReply', () => {
  it('returns reply when the conversation is active and no state record yet', () => {
    expect(shouldAgentReply('active', null)).toEqual({ reply: true })
  })

  it('returns reply when the conversation is active and state is ACTIVE', () => {
    expect(shouldAgentReply('active', { state: 'ACTIVE' })).toEqual({ reply: true })
  })

  it('refuses to reply when an operator has taken over (status = handed_off)', () => {
    // The "Jump in" / direct-reply path on the inbox flips
    // WidgetConversation.status to 'handed_off' but DOES NOT touch
    // ConversationStateRecord. This was the bug QA was hitting:
    // pre-fix, the runner only checked the latter.
    expect(shouldAgentReply('handed_off', null)).toEqual({ reply: false, reason: 'handed_off' })
    expect(shouldAgentReply('handed_off', { state: 'ACTIVE' })).toEqual({ reply: false, reason: 'handed_off' })
  })

  it('refuses to reply when the conversation is ended/resolved', () => {
    expect(shouldAgentReply('ended', null)).toEqual({ reply: false, reason: 'ended' })
  })

  it('refuses to reply when ConversationStateRecord is PAUSED', () => {
    // The /api/workspaces/[id]/takeover endpoint pauses
    // ConversationStateRecord with pauseReason='human_takeover'.
    // Stop-condition pauses also land here.
    expect(shouldAgentReply('active', { state: 'PAUSED' })).toEqual({ reply: false, reason: 'paused' })
  })

  it('refuses to reply when BOTH state machines say stop', () => {
    // Belt-and-braces: an operator could both Jump in (status=handed_off)
    // AND hit the formal takeover endpoint (state=PAUSED). The handed_off
    // signal wins for messaging since it carries the channel-specific
    // reason, but either silences the agent.
    const out = shouldAgentReply('handed_off', { state: 'PAUSED' })
    expect(out.reply).toBe(false)
  })
})
