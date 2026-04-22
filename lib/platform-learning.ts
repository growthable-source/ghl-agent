import { db } from './db'

/**
 * Helpers for applying and retiring PlatformLearning rows.
 *
 * Every applied prompt_addition is fenced in the target agent's
 * systemPrompt with HTML-style marker comments keyed by the learning's
 * id. This makes Retire a safe string-replace: we don't have to
 * remember what the prompt looked like beforehand.
 *
 * Markers look like:
 *
 *   <!-- learning:<id> -->
 *   <one blank line>
 *   <content>
 *   <one blank line>
 *   <!-- /learning:<id> -->
 *
 * If an admin manually edits the fenced block in the agent UI, the
 * block continues to retire cleanly — we only match on the start/end
 * markers, not on what's between them.
 */

export function beginMarker(learningId: string): string {
  return `<!-- learning:${learningId} -->`
}

export function endMarker(learningId: string): string {
  return `<!-- /learning:${learningId} -->`
}

/**
 * Return a new systemPrompt with the learning content appended in a
 * fenced block. If a block with this learning's id already exists,
 * it's a no-op (prevents duplicate application on a double-click).
 */
export function appendLearningToPrompt(
  currentPrompt: string,
  learningId: string,
  content: string,
): string {
  const start = beginMarker(learningId)
  const end = endMarker(learningId)
  if (currentPrompt.includes(start)) {
    return currentPrompt
  }
  const block = `\n\n${start}\n${content.trim()}\n${end}`
  return currentPrompt + block
}

/**
 * Strip the fenced block for `learningId` out of the prompt. Returns
 * the prompt unchanged if no block was found.
 */
export function removeLearningFromPrompt(
  currentPrompt: string,
  learningId: string,
): string {
  const start = beginMarker(learningId)
  const end = endMarker(learningId)
  const startIdx = currentPrompt.indexOf(start)
  if (startIdx === -1) return currentPrompt
  const endIdx = currentPrompt.indexOf(end, startIdx)
  if (endIdx === -1) return currentPrompt
  // Include any trailing newline after the end marker so the prompt
  // doesn't accumulate empty gaps over many retire cycles.
  const stripEnd = endIdx + end.length
  const trailing = currentPrompt.charAt(stripEnd) === '\n' ? 1 : 0
  // Also strip the leading blank line we added before the start marker.
  const leading = currentPrompt.charAt(startIdx - 1) === '\n'
    && currentPrompt.charAt(startIdx - 2) === '\n'
    ? 1
    : 0
  return currentPrompt.slice(0, startIdx - leading) + currentPrompt.slice(stripEnd + trailing)
}

/**
 * Apply an approved prompt_addition learning to its target agent. This
 * is the single source of truth for the "actually change the agent"
 * step — both the admin UI and any future auto-apply logic go through
 * here so the bookkeeping (status=applied, appliedAt, appliedTarget) is
 * consistent.
 *
 * Returns { ok: true } on success or { ok: false, error } so callers
 * can surface a friendly error without try/catch juggling.
 */
export async function applyLearning(learningId: string): Promise<
  | { ok: true; agentId: string }
  | { ok: false; error: string }
> {
  const learning = await db.platformLearning.findUnique({
    where: { id: learningId },
    select: { id: true, status: true, type: true, content: true, agentId: true, scope: true },
  })
  if (!learning) return { ok: false, error: 'Learning not found' }
  if (learning.status === 'applied') return { ok: false, error: 'Already applied' }
  if (learning.status !== 'approved') return { ok: false, error: 'Must be approved before applying' }
  if (learning.type !== 'prompt_addition') {
    return { ok: false, error: `Unsupported learning type: ${learning.type}` }
  }
  if (learning.scope !== 'this_agent' || !learning.agentId) {
    return { ok: false, error: `Unsupported scope for PR 1: ${learning.scope}` }
  }

  const agent = await db.agent.findUnique({
    where: { id: learning.agentId },
    select: { id: true, systemPrompt: true },
  })
  if (!agent) return { ok: false, error: 'Target agent no longer exists' }

  const nextPrompt = appendLearningToPrompt(
    agent.systemPrompt ?? '',
    learning.id,
    learning.content,
  )

  // Two writes in a transaction so we never end up with a learning
  // marked applied against a prompt that didn't actually change.
  await db.$transaction([
    db.agent.update({
      where: { id: agent.id },
      data: { systemPrompt: nextPrompt },
    }),
    db.platformLearning.update({
      where: { id: learning.id },
      data: {
        status: 'applied',
        appliedAt: new Date(),
        appliedTarget: 'agent.systemPrompt',
      },
    }),
  ])

  return { ok: true, agentId: agent.id }
}

/**
 * Retire a previously applied learning — strip it from the agent's
 * system prompt and flip its status to "retired". Safe to call even if
 * the fenced block was manually edited; we only match the markers.
 */
export async function retireLearning(learningId: string): Promise<
  | { ok: true }
  | { ok: false; error: string }
> {
  const learning = await db.platformLearning.findUnique({
    where: { id: learningId },
    select: { id: true, status: true, agentId: true },
  })
  if (!learning) return { ok: false, error: 'Learning not found' }
  if (learning.status !== 'applied') {
    return { ok: false, error: 'Only applied learnings can be retired' }
  }
  if (!learning.agentId) {
    return { ok: false, error: 'Learning has no target agent' }
  }

  const agent = await db.agent.findUnique({
    where: { id: learning.agentId },
    select: { id: true, systemPrompt: true },
  })
  // Even if the agent was deleted we still flip status so the queue
  // doesn't lie about state. Without an agent there's nothing to strip.
  if (agent) {
    const nextPrompt = removeLearningFromPrompt(
      agent.systemPrompt ?? '',
      learning.id,
    )
    await db.$transaction([
      db.agent.update({
        where: { id: agent.id },
        data: { systemPrompt: nextPrompt },
      }),
      db.platformLearning.update({
        where: { id: learning.id },
        data: { status: 'retired' },
      }),
    ])
  } else {
    await db.platformLearning.update({
      where: { id: learning.id },
      data: { status: 'retired' },
    })
  }

  return { ok: true }
}
