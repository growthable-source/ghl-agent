/**
 * Co-Pilot conversational building blocks (Advanced procedure mode).
 *
 * A block is one conversational move — a plain-English instruction, an
 * optional "wait for the user's reply" pause, and 0–N IF→THEN rules. The
 * IF (`when`) is a semantic condition the live agent judges from the call;
 * the THEN branches: jump to another block, do an inline alternative then
 * continue, or end/hand off. These pure helpers render the flow into the
 * live system prompt and normalize operator-authored input. No I/O.
 */

export type BlockThenAction = 'jump' | 'instruct' | 'end'

export interface BlockThen {
  action: BlockThenAction
  /** For 'jump': the target block id. */
  targetId?: string
  /** For 'instruct': the inline alternative to do, then continue. */
  instruction?: string
}

export interface BlockRule {
  id: string
  /** Semantic condition the agent evaluates ("the user can't share screen"). */
  when: string
  then: BlockThen
}

export interface CopilotBlock {
  id: string
  /** Short name — shown in the builder and used as a jump-target label. */
  label: string
  /** What the agent says/does in this block. */
  instruction: string
  /** When true, the agent pauses for the user's reply before evaluating rules. */
  waitForResponse: boolean
  rules: BlockRule[]
}

const ALLOWED_ACTIONS: BlockThenAction[] = ['jump', 'instruct', 'end']

let idCounter = 0
function genId(prefix: string): string {
  // Deterministic-enough within a request; ids only need to be unique
  // within one agent's block set. Avoids Math.random (banned in workflows
  // and unnecessary here).
  idCounter += 1
  return `${prefix}${idCounter}_${idCounter * 2654435761 % 100000}`
}

/**
 * Render the building-block flow for the live system prompt. Returns ''
 * when there are no usable blocks so the caller can append unconditionally.
 */
export function buildCopilotBlockFlow(blocks: CopilotBlock[]): string {
  const usable = blocks.filter(b => b.instruction?.trim())
  if (!usable.length) return ''

  const labelOf = (id: string | undefined) =>
    usable.find(b => b.id === id)?.label ?? 'a later block'

  const lines: string[] = [
    `\n## You are RUNNING this guided flow`,
    `Work these blocks in order, top to bottom. Do what each one says. A block marked [waits for the user's reply] means: say your part, then pause and let them respond before you decide anything. After each block, check its rules against what the user said or what you can see on screen, and follow the FIRST rule that matches. If no rule matches, continue to the next block in order.`,
    ``,
  ]

  usable.forEach((b, i) => {
    const wait = b.waitForResponse ? ' [waits for the user\'s reply]' : ''
    lines.push(`Block ${i + 1} — "${b.label}":${wait} ${b.instruction.trim()}`)
    for (const r of b.rules ?? []) {
      if (!r.when?.trim()) continue
      let action: string
      if (r.then.action === 'jump') action = `jump to "${labelOf(r.then.targetId)}"`
      else if (r.then.action === 'instruct') action = `${r.then.instruction?.trim() || 'handle it'}, then continue`
      else action = `end the call (wrap up / hand off to a human)`
      lines.push(`   • IF ${r.when.trim()} → ${action}`)
    }
  })

  lines.push(
    ``,
    `Branch exactly as the rules say — this flow is allowed to skip and jump; that is the point. Keep momentum, observe the screen before each instruction, and close with a short recap of what was done and what's next.`,
  )
  return lines.join('\n')
}

/**
 * Validate + normalize operator-authored blocks for persistence: drop
 * blocks with no instruction, assign stable ids where missing, coerce the
 * shape, and keep only well-formed rules (non-empty `when`, allowed action).
 */
export function normalizeBlocks(input: unknown): CopilotBlock[] {
  if (!Array.isArray(input)) return []
  const out: CopilotBlock[] = []
  for (const raw of input) {
    const b = raw as Record<string, any>
    const instruction = typeof b?.instruction === 'string' ? b.instruction.trim() : ''
    if (!instruction) continue
    const id = typeof b?.id === 'string' && b.id ? b.id : genId('b')
    const label = (typeof b?.label === 'string' && b.label.trim() ? b.label.trim() : `Step ${out.length + 1}`).slice(0, 80)
    const rules: BlockRule[] = []
    if (Array.isArray(b?.rules)) {
      for (const rr of b.rules) {
        const r = rr as Record<string, any>
        const when = typeof r?.when === 'string' ? r.when.trim() : ''
        const action = r?.then?.action
        if (!when || !ALLOWED_ACTIONS.includes(action)) continue
        rules.push({
          id: typeof r?.id === 'string' && r.id ? r.id : genId('r'),
          when: when.slice(0, 300),
          then: {
            action,
            ...(action === 'jump' && typeof r.then.targetId === 'string' ? { targetId: r.then.targetId } : {}),
            ...(action === 'instruct' && typeof r.then.instruction === 'string' ? { instruction: r.then.instruction.slice(0, 500) } : {}),
          },
        })
      }
    }
    out.push({ id, label, instruction: instruction.slice(0, 1000), waitForResponse: !!b?.waitForResponse, rules })
  }
  return out
}
