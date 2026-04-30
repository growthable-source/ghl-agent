/**
 * Pure assertions for grading a simulator transcript.
 *
 * The existing lib/simulator.ts produces a TranscriptTurn[] — alternating
 * persona ↔ agent turns with the agent's tool calls captured per turn.
 * That structure is rich enough to ask "did the agent do the right thing?"
 * without firing up an LLM judge, and the answers are deterministic given
 * a fixed transcript.
 *
 * Tests live alongside in scenario-assertions.test.ts.
 *
 * The intended usage pattern:
 *
 *   const sim = await runSimulation(simId)
 *   const turns = await loadTranscript(simId)
 *   const result = evaluateScenario(turns, [
 *     calledTool('book_appointment'),
 *     toolCalledAtMostNTimes('get_available_slots', 1),
 *     agentTextMatches(/eastern|EST|EDT|America\/New_York/i, { reason: 'must surface timezone' }),
 *   ])
 *   if (!result.passed) console.error(result.failures)
 *
 * Composable + zero dependencies on Anthropic, Prisma, or anything else
 * — just the in-memory turn array.
 */

import { isShortAffirmation } from './agent-heuristics'

export interface AgentTurn {
  role: 'persona' | 'agent'
  content: string
  at?: string
  toolCalls?: Array<{ tool: string; input?: unknown; output?: string }>
}

export interface AssertionFailure {
  assertion: string
  reason: string
}

export interface ScenarioResult {
  passed: boolean
  failures: AssertionFailure[]
  /** Convenience: count of agent + persona turns evaluated. */
  turnCount: number
}

export type Assertion = (turns: AgentTurn[]) => AssertionFailure | null

// ─── Tool-call assertions ────────────────────────────────────────────────

/** Assert that the agent called this tool at least once during the run. */
export function calledTool(tool: string, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const seen = turns.some(t => t.role === 'agent' && (t.toolCalls ?? []).some(tc => tc.tool === tool))
    if (seen) return null
    return {
      assertion: `calledTool("${tool}")`,
      reason: opts.reason ?? `Expected the agent to call "${tool}" at least once but it never did.`,
    }
  }
}

/** Assert that the agent did NOT call this tool. */
export function neverCalledTool(tool: string, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const idx = turns.findIndex(t => t.role === 'agent' && (t.toolCalls ?? []).some(tc => tc.tool === tool))
    if (idx === -1) return null
    return {
      assertion: `neverCalledTool("${tool}")`,
      reason: opts.reason ?? `Agent called "${tool}" at agent turn index ${idx}; it shouldn't have.`,
    }
  }
}

/** Bound the number of times a tool was called across the whole transcript. */
export function toolCalledAtMostNTimes(tool: string, n: number, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const count = turns.reduce((acc, t) => acc + (t.toolCalls ?? []).filter(tc => tc.tool === tool).length, 0)
    if (count <= n) return null
    return {
      assertion: `toolCalledAtMostNTimes("${tool}", ${n})`,
      reason: opts.reason ?? `Expected at most ${n} call(s) to "${tool}" but found ${count}. This is the going-in-circles signal: the agent is re-fetching slots after already offering some.`,
    }
  }
}

/** Lower bound on tool-call count. */
export function toolCalledAtLeastNTimes(tool: string, n: number, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const count = turns.reduce((acc, t) => acc + (t.toolCalls ?? []).filter(tc => tc.tool === tool).length, 0)
    if (count >= n) return null
    return {
      assertion: `toolCalledAtLeastNTimes("${tool}", ${n})`,
      reason: opts.reason ?? `Expected at least ${n} call(s) to "${tool}" but found ${count}.`,
    }
  }
}

// ─── Text assertions ─────────────────────────────────────────────────────

/** Assert at least one agent reply matches the regex. */
export function agentTextMatches(pattern: RegExp, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const found = turns.some(t => t.role === 'agent' && pattern.test(t.content ?? ''))
    if (found) return null
    return {
      assertion: `agentTextMatches(${pattern})`,
      reason: opts.reason ?? `No agent message matched ${pattern}. Inspect the transcript for what the agent said instead.`,
    }
  }
}

/** Assert NO agent reply matches the regex (e.g., banned phrasings). */
export function agentTextNeverMatches(pattern: RegExp, opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    const idx = turns.findIndex(t => t.role === 'agent' && pattern.test(t.content ?? ''))
    if (idx === -1) return null
    return {
      assertion: `agentTextNeverMatches(${pattern})`,
      reason: opts.reason ?? `Agent message at turn ${idx} matched a banned pattern ${pattern}: "${(turns[idx].content ?? '').slice(0, 120)}"`,
    }
  }
}

// ─── Ordering assertions ─────────────────────────────────────────────────

/**
 * After the agent's first call to `firstTool`, the persona's NEXT short
 * affirmation MUST be followed by a call to `expectedNextTool` on the
 * agent's next turn — never a re-call of `firstTool`. This is the
 * confirm→book invariant in transcript shape.
 */
export function confirmationLeadsTo(expectedNextTool: string, firstTool = 'get_available_slots', opts: { reason?: string } = {}): Assertion {
  return (turns) => {
    // Find the first agent turn that called `firstTool`.
    const firstToolIdx = turns.findIndex(t => t.role === 'agent' && (t.toolCalls ?? []).some(tc => tc.tool === firstTool))
    if (firstToolIdx === -1) {
      // The first tool was never called — this assertion isn't applicable.
      return null
    }
    // Walk forward looking for a persona affirmation.
    for (let i = firstToolIdx + 1; i < turns.length; i++) {
      const t = turns[i]
      if (t.role !== 'persona') continue
      if (!isShortAffirmation(t.content)) continue
      // Found a short affirmation; the next agent turn must call expectedNextTool.
      const nextAgent = turns.slice(i + 1).find(x => x.role === 'agent')
      if (!nextAgent) {
        return {
          assertion: `confirmationLeadsTo("${expectedNextTool}")`,
          reason: `Persona confirmed at turn ${i} ("${(t.content ?? '').slice(0, 40)}") but there was no following agent turn at all.`,
        }
      }
      const calledNext = (nextAgent.toolCalls ?? []).some(tc => tc.tool === expectedNextTool)
      if (calledNext) return null
      return {
        assertion: `confirmationLeadsTo("${expectedNextTool}")`,
        reason: opts.reason ?? `After persona confirmed at turn ${i}, the agent did NOT call "${expectedNextTool}" on its next turn — it called: ${(nextAgent.toolCalls ?? []).map(tc => tc.tool).join(', ') || '(no tools)'}. This is the going-in-circles bug.`,
      }
    }
    // No affirmation occurred — vacuously passes.
    return null
  }
}

// ─── Top-level evaluator ─────────────────────────────────────────────────

export function evaluateScenario(turns: AgentTurn[], assertions: Assertion[]): ScenarioResult {
  const failures: AssertionFailure[] = []
  for (const assertion of assertions) {
    const failure = assertion(turns)
    if (failure) failures.push(failure)
  }
  return {
    passed: failures.length === 0,
    failures,
    turnCount: turns.length,
  }
}
