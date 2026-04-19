/**
 * Detection Rules
 *
 * User-authored "IF the contact says X, THEN update contact field Y to Z"
 * rules. The condition is natural-language plus few-shot examples; the
 * agent evaluates it semantically against each inbound message and uses
 * the `update_contact_field` tool when it fires.
 *
 * Companion to QualifyingQuestion — qualifying *asks* for information;
 * detection rules *listen* for it without asking. Overwrite semantics
 * mirror QualifyingQuestion.overwrite.
 */

import { db } from './db'

export interface DetectionRuleInput {
  name: string
  conditionDescription: string
  examples: string[]
  targetFieldKey: string
  targetValue: string
  overwrite: boolean
}

export interface LoadedDetectionRule extends DetectionRuleInput {
  id: string
  isActive: boolean
  order: number
}

/** Load active detection rules for an agent, in display order. */
export async function getActiveDetectionRules(agentId: string): Promise<LoadedDetectionRule[]> {
  const rows = await (db as any).agentRule.findMany({
    where: { agentId, isActive: true },
    orderBy: { order: 'asc' },
  })
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    conditionDescription: r.conditionDescription,
    examples: r.examples ?? [],
    targetFieldKey: r.targetFieldKey,
    targetValue: r.targetValue,
    overwrite: r.overwrite,
    isActive: r.isActive,
    order: r.order,
  }))
}

/**
 * Render the rules as a prompt block the agent consults on every turn.
 * Keep it compact — each rule is a few lines + its examples — so we don't
 * blow up context on agents with lots of rules.
 */
export function buildDetectionRulesBlock(rules: LoadedDetectionRule[]): string {
  if (rules.length === 0) return ''

  const body = rules.map((r, i) => {
    const exampleLines = r.examples.length
      ? r.examples.map(e => `    • "${e}"`).join('\n')
      : '    (no examples given)'
    return (
`${i + 1}. ${r.name}
   Fires when: ${r.conditionDescription}
   Examples that should match:
${exampleLines}
   → Use update_contact_field to set "${r.targetFieldKey}" to "${r.targetValue}"
   Overwrite existing value: ${r.overwrite ? 'Yes — always update' : 'No — keep the first value that was set'}`
    )
  }).join('\n\n')

  return `\n\n## Detection Rules
On every inbound message, check whether any of the rules below fire. A rule
fires when the contact's message matches the "Fires when" description
semantically — the examples are illustrative, not exhaustive. Paraphrases,
typos, and indirect confirmations should still match.

When a rule fires, call update_contact_field with the target field and value.
If the rule says "keep the first value", and the field already has content,
the tool will no-op — that is expected, you don't need to check yourself.

Continue composing your reply as normal. Firing a rule does NOT mean skipping
the reply, and calling update_contact_field does NOT replace send_reply.

${body}`
}

/**
 * Build the fieldKey → overwrite map that executeTool uses to enforce
 * first-answer semantics when the agent writes to rule-governed fields.
 * Fields not in this map write through directly.
 */
export function buildFieldOverwriteMap(rules: LoadedDetectionRule[]): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const r of rules) map[r.targetFieldKey] = r.overwrite
  return map
}
