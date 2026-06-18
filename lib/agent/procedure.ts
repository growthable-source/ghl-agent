/**
 * Procedural-agent helpers — pure, no I/O.
 *
 * A procedural agent walks an ordered sequence of steps with real progress
 * ("step 2 of 3"). These helpers build the system-prompt block that states
 * the current step + progress, and evaluate a step's answer rules to decide
 * whether to advance, skip, jump, or stop. Reactive agents never call these.
 */

export interface ProcRule {
  when: string
  action: 'skip' | 'jump' | 'stop'
  target?: string
}

export interface ProcStep {
  id: string
  order: number
  title: string
  instruction: string
  question: string | null
  collectFieldKey: string | null
  rules: ProcRule[]
}

export type StepOutcome =
  | { action: 'advance' }
  | { action: 'jump'; target?: string }
  | { action: 'skip' }
  | { action: 'stop' }

/**
 * Build the procedural system-prompt block. Returns '' when there are no
 * steps so the caller can append unconditionally. `currentOrder` is the
 * 0-based index of the active step (clamped into range).
 */
export function buildProcedureBlock(
  steps: ProcStep[],
  currentOrder: number,
  mode: 'simple' | 'advanced',
): string {
  if (!steps.length) return ''
  const ordered = [...steps].sort((a, b) => a.order - b.order)
  const total = ordered.length
  const idx = Math.max(0, Math.min(currentOrder, total - 1))
  const cur = ordered[idx]

  const list = ordered
    .map((s, i) => `${i + 1}. ${s.title}${i === idx ? '  ← CURRENT' : ''}`)
    .join('\n')

  let block =
    `\n\n## Procedure — follow these steps in order\n\n` +
    `You are running a guided procedure. You are on **Step ${idx + 1} of ${total}**. ` +
    `Announce progress naturally ("step ${idx + 1} of ${total}"). Only move on once the ` +
    `current step's goal is met. Call \`advance_procedure_step\` to record progress; ` +
    `set done=true when the final step completes.\n\n${list}\n\n` +
    `### Current step: ${cur.title}\n${cur.instruction}`

  if (cur.question) block += `\nAsk: "${cur.question}"`

  if (mode === 'advanced' && cur.rules?.length) {
    const r = cur.rules
      .map(x => `- If the answer indicates "${x.when}" → ${x.action}${x.action === 'jump' && x.target ? ` (jump)` : ''}`)
      .join('\n')
    block +=
      `\n\nRules for this step's answer:\n${r}\n` +
      `Call \`advance_procedure_step\` with the matching outcome (skip / jump / stop / next).`
  }

  return block
}

/**
 * Decide what happens after the current step given the visitor's answer.
 * First matching rule wins (case-insensitive substring match); otherwise
 * advance to the next step.
 */
export function evaluateStepRules(step: ProcStep, answer: string): StepOutcome {
  const a = (answer || '').toLowerCase()
  for (const rule of step.rules ?? []) {
    if (rule.when && a.includes(rule.when.toLowerCase())) {
      if (rule.action === 'jump') return { action: 'jump', target: rule.target }
      if (rule.action === 'skip') return { action: 'skip' }
      if (rule.action === 'stop') return { action: 'stop' }
    }
  }
  return { action: 'advance' }
}
