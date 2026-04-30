import { describe, it, expect } from 'vitest'
import {
  evaluateScenario,
  calledTool,
  neverCalledTool,
  toolCalledAtMostNTimes,
  toolCalledAtLeastNTimes,
  agentTextMatches,
  agentTextNeverMatches,
  confirmationLeadsTo,
  type AgentTurn,
} from './scenario-assertions'

// Helper to build transcripts compactly in test bodies.
const persona = (content: string): AgentTurn => ({ role: 'persona', content })
const agent = (content: string, tools: Array<{ tool: string; output?: string }> = []): AgentTurn => ({
  role: 'agent', content, toolCalls: tools,
})

// ─── Reference transcripts ───────────────────────────────────────────────

/**
 * The screenshot bug, in transcript form. Agent proposes 11:45am, persona
 * says "Yes", agent re-calls get_available_slots and offers different
 * times instead of booking. Every assertion designed to guard the
 * confirm-then-book invariant must FAIL on this transcript.
 */
const goingInCirclesTranscript: AgentTurn[] = [
  persona('Can I book an appointment?'),
  agent('I can do Monday May 5th at 11:45am or 2:30pm — which works better?', [
    { tool: 'get_available_slots' },
  ]),
  persona('11.45'),
  agent('I have Monday, May 5th at 11:45am available — does that work for you?'),
  persona('Yes'),
  // BUG: agent re-calls get_available_slots and offers different times
  // instead of book_appointment.
  agent('Great! I can get you in tomorrow (Thursday) at 10am or Monday at 2:30pm. Which works better for you?', [
    { tool: 'get_available_slots' },
  ]),
]

/**
 * What the agent SHOULD do: after the persona confirms, call book.
 */
const happyPathTranscript: AgentTurn[] = [
  persona('Can I book an appointment?'),
  agent('I can do Monday May 5th at 11:45am Eastern or 2:30pm Eastern — which works better?', [
    { tool: 'get_available_slots' },
  ]),
  persona('Yes, 11:45am works'),
  agent("You're booked for Monday May 5 at 11:45am Eastern. See you then!", [
    { tool: 'book_appointment' },
    { tool: 'create_appointment_note' },
  ]),
]

// ─── Top-level evaluator ─────────────────────────────────────────────────

describe('evaluateScenario', () => {
  it('passes when all assertions pass', () => {
    const r = evaluateScenario(happyPathTranscript, [
      calledTool('book_appointment'),
      neverCalledTool('transfer_to_human'),
    ])
    expect(r.passed).toBe(true)
    expect(r.failures).toHaveLength(0)
    expect(r.turnCount).toBe(4)
  })

  it('collects every failure rather than short-circuiting', () => {
    const r = evaluateScenario(happyPathTranscript, [
      neverCalledTool('book_appointment'), // will fail
      neverCalledTool('create_appointment_note'), // will fail
    ])
    expect(r.passed).toBe(false)
    expect(r.failures).toHaveLength(2)
  })
})

// ─── Tool-call assertions ────────────────────────────────────────────────

describe('calledTool', () => {
  it('passes when the tool was called', () => {
    expect(calledTool('book_appointment')(happyPathTranscript)).toBeNull()
  })

  it('fails when the tool was never called', () => {
    const f = calledTool('book_appointment')(goingInCirclesTranscript)
    expect(f).not.toBeNull()
    expect(f!.assertion).toContain('book_appointment')
  })
})

describe('neverCalledTool', () => {
  it('passes when the tool wasn\'t called', () => {
    expect(neverCalledTool('transfer_to_human')(happyPathTranscript)).toBeNull()
  })

  it('fails when the tool was called', () => {
    const f = neverCalledTool('book_appointment')(happyPathTranscript)
    expect(f).not.toBeNull()
  })
})

describe('toolCalledAtMostNTimes', () => {
  it('catches the going-in-circles bug — get_available_slots > 1', () => {
    const f = toolCalledAtMostNTimes('get_available_slots', 1)(goingInCirclesTranscript)
    expect(f).not.toBeNull()
    expect(f!.reason).toMatch(/found 2/)
  })

  it('passes when the bound is respected', () => {
    expect(toolCalledAtMostNTimes('get_available_slots', 1)(happyPathTranscript)).toBeNull()
  })

  it('also passes when the tool was never called', () => {
    expect(toolCalledAtMostNTimes('transfer_to_human', 0)(happyPathTranscript)).toBeNull()
  })
})

describe('toolCalledAtLeastNTimes', () => {
  it('passes when the count meets the floor', () => {
    expect(toolCalledAtLeastNTimes('get_available_slots', 1)(goingInCirclesTranscript)).toBeNull()
  })

  it('fails when the count is below the floor', () => {
    const f = toolCalledAtLeastNTimes('book_appointment', 1)(goingInCirclesTranscript)
    expect(f).not.toBeNull()
  })
})

// ─── Text assertions ─────────────────────────────────────────────────────

describe('agentTextMatches', () => {
  it('passes when at least one agent message matches', () => {
    expect(agentTextMatches(/Eastern|EST|EDT/)(happyPathTranscript)).toBeNull()
  })

  it('catches the timezone-omission bug from the screenshot', () => {
    // The going-in-circles transcript never mentions a timezone.
    const f = agentTextMatches(/Eastern|EST|EDT|America\//)(goingInCirclesTranscript)
    expect(f).not.toBeNull()
  })
})

describe('agentTextNeverMatches', () => {
  it('passes when no agent message matches the banned pattern', () => {
    expect(agentTextNeverMatches(/several afternoon slots/i)(happyPathTranscript)).toBeNull()
  })

  it('fails when the banned phrasing appears', () => {
    const t: AgentTurn[] = [
      persona('book me'),
      agent('I have several afternoon slots available — how about 9:45am?', [
        { tool: 'get_available_slots' },
      ]),
    ]
    const f = agentTextNeverMatches(/several afternoon slots/i)(t)
    expect(f).not.toBeNull()
  })
})

// ─── confirmationLeadsTo (the headline assertion) ───────────────────────

describe('confirmationLeadsTo', () => {
  it('CATCHES the going-in-circles bug from the screenshot', () => {
    // This is the test that would have flagged the production bug.
    // Persona confirmed with "Yes" at turn 4, but the agent's next move
    // was another get_available_slots, not book_appointment.
    const f = confirmationLeadsTo('book_appointment')(goingInCirclesTranscript)
    expect(f).not.toBeNull()
    expect(f!.reason).toMatch(/going-in-circles/)
  })

  it('passes the happy path', () => {
    expect(confirmationLeadsTo('book_appointment')(happyPathTranscript)).toBeNull()
  })

  it('is vacuously satisfied when no confirmation appears', () => {
    const t: AgentTurn[] = [
      persona('What times do you have?'),
      agent('I have 11:45am or 2:30pm — which works?', [{ tool: 'get_available_slots' }]),
      persona('I need to think about it'),
      agent('No problem, take your time.'),
    ]
    expect(confirmationLeadsTo('book_appointment')(t)).toBeNull()
  })

  it('is vacuously satisfied when get_available_slots was never called', () => {
    // If the agent never offered any times, there's nothing to confirm.
    const t: AgentTurn[] = [
      persona('hi'),
      agent('Hello! How can I help you today?'),
      persona('yes'),
    ]
    expect(confirmationLeadsTo('book_appointment')(t)).toBeNull()
  })

  it('does not fire on timezone-request "yes-shaped" replies', () => {
    // "ok but in PST" is recognised as a non-confirmation by isShortAffirmation;
    // therefore confirmationLeadsTo doesn't try to enforce book_appointment here.
    const t: AgentTurn[] = [
      persona('book a call'),
      agent('I have 11:45am Eastern or 2:30pm Eastern — which works?', [
        { tool: 'get_available_slots' },
      ]),
      persona('ok but in PST'),
      agent('Sure — let me re-check in PST.', [
        { tool: 'get_available_slots' },
      ]),
    ]
    expect(confirmationLeadsTo('book_appointment')(t)).toBeNull()
  })
})
