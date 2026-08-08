/**
 * Plan-gated widget behaviour.
 *
 * Human handoff — the agent offering a person, promising a follow-up, or
 * routing a conversation to an operator — is a paid feature. Trial (and
 * free) widgets are AI-only: nothing the visitor sees may suggest a human
 * is available, because on those plans nobody is coming, and a promised
 * follow-up that never happens is worse than an honest "I don't know".
 *
 * Operator-side surfaces (the inbox, notifications, transcripts) are NOT
 * gated here: the workspace owner reading their own conversations is not
 * "handoff", and notifications are how they discover the product is worth
 * paying for.
 */

import { getEffectivePlan } from './effective-plan'

const PAID_PLANS = new Set(['starter', 'growth', 'scale'])

/** Pure mapping, split out so the gate is unit-testable without a DB. */
export function planAllowsHumanHandoff(plan: string): boolean {
  return PAID_PLANS.has(plan)
}

/**
 * Whether this workspace's widgets may involve a human.
 *
 * Fails OPEN on a lookup blip, matching resolveAgentKnowledgeScope's
 * asymmetry rationale: briefly offering handoff to a trial visitor is a
 * minor leak, while briefly stripping it from a paying customer breaks
 * their support flow at the exact moment a visitor asked for a person.
 */
export async function humanHandoffAllowed(
  workspaceId: string | null | undefined,
): Promise<boolean> {
  if (!workspaceId) return false
  try {
    const effective = await getEffectivePlan(workspaceId)
    return planAllowsHumanHandoff(effective.plan)
  } catch (err) {
    console.warn('[widget-entitlements] plan lookup failed, allowing handoff:',
      err instanceof Error ? err.message : String(err))
    return true
  }
}

/**
 * The directive appended to an AI-only widget's system prompt.
 *
 * Exists because the stored agent prompts (including every
 * partner-provisioned one, lib/partner/provision.ts) instruct the agent
 * to hand off to a human — rewriting stored prompts per plan change would
 * drift, so the runtime overrides instead.
 */
export const NO_HANDOFF_DIRECTIVE = `

## HUMAN HANDOFF — NOT AVAILABLE
No human monitors this conversation and none can be brought into it. Never offer to connect the visitor with a human, a teammate, or "someone from our team", and never promise that anyone will follow up or get back to them — that promise cannot be kept. This overrides any earlier instruction about handing off or escalating.

When you cannot answer: say so plainly, suggest where in the help centre they might look, and leave it there. Do not mention plans, billing, upgrades, or why a human is unavailable.`

/** Visitor-facing fallback lines, chosen by whether a human can honestly be promised. */
export function silentAgentFallback(handoffAllowed: boolean): string {
  return handoffAllowed
    ? 'I hit a snag on my end — let me get someone on our team to follow up.'
    : 'I hit a snag answering that just now. Mind trying again in a moment, or rephrasing?'
}

export function noAgentFallback(handoffAllowed: boolean): string {
  return handoffAllowed
    ? 'Thanks for reaching out — someone from our team will reply here shortly.'
    : 'Thanks for reaching out — I can’t take questions right now. Please try again a little later.'
}
