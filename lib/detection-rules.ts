/**
 * Detection Rules
 *
 * User-authored "IF the contact says X, THEN do Y" rules. The condition is
 * a natural-language description plus few-shot examples; the agent evaluates
 * it semantically on every inbound message and calls the appropriate tool.
 *
 * Action types supported (actionType column):
 *   - update_contact_field        → set a standard or custom field
 *   - update_contact_tags         → add tags (params.tags)
 *   - remove_contact_tags         → remove tags (params.tags)
 *   - add_to_workflow             → enrol in workflows (params.workflowIds)
 *   - remove_from_workflow        → remove from workflows (params.workflowIds)
 *   - opportunity_status          → set status (params.status)
 *   - opportunity_value           → set monetaryValue (params.monetaryValue)
 *   - dnd_channel                 → mark DND (params.channel, defaults to
 *                                   current conversation channel)
 *
 * Companion to QualifyingQuestion: qualifying ASKS for info, detection
 * rules LISTEN for it without asking.
 */

import { db } from './db'

export interface LoadedDetectionRule {
  id: string
  name: string
  conditionDescription: string
  examples: string[]
  actionType: string
  actionParams: Record<string, any> | null

  // Legacy fields — only meaningful when actionType === 'update_contact_field'.
  // Kept at top level for back-compat with rows authored before actionType
  // existed.
  targetFieldKey: string
  targetValue: string
  overwrite: boolean

  isActive: boolean
  order: number
}

/** Load active detection rules for an agent, in display order. */
export async function getActiveDetectionRules(agentId: string): Promise<LoadedDetectionRule[]> {
  let rows: any[]
  try {
    rows = await (db as any).agentRule.findMany({
      where: { agentId, isActive: true },
      orderBy: { order: 'asc' },
    })
  } catch (err: any) {
    // Missing table (P2021) or missing column (P2022) means a manual
    // migration hasn't run in this environment. Log loudly so operators
    // know *which* migration to run, then return empty so the agent
    // still responds to the inbound instead of throwing and killing the
    // whole webhook turn. This was the root cause of "agent didn't fire
    // after my inbound message" — the detection-rules query threw and
    // the caller had no rescue path.
    if (
      err?.code === 'P2021'
      || err?.code === 'P2022'
      || /column .* does not exist/i.test(err?.message ?? '')
      || /relation .* does not exist/i.test(err?.message ?? '')
    ) {
      console.error(
        '[DetectionRules] AgentRule table/column missing — skipping rules for this agent. '
        + 'Run prisma/migrations/manual_rule_actions.sql on the database. Err:',
        err.message,
      )
      return []
    }
    throw err
  }
  return rows.map((r: any) => ({
    id: r.id,
    name: r.name,
    conditionDescription: r.conditionDescription,
    examples: r.examples ?? [],
    actionType: r.actionType ?? 'update_contact_field',
    actionParams: r.actionParams ?? null,
    targetFieldKey: r.targetFieldKey ?? '',
    targetValue: r.targetValue ?? '',
    overwrite: r.overwrite ?? false,
    isActive: r.isActive,
    order: r.order,
  }))
}

/**
 * Render one rule's THEN clause into a human+agent-readable sentence. Used
 * both in the prompt block and the UI preview.
 */
function describeAction(rule: LoadedDetectionRule): string {
  const p = rule.actionParams ?? {}
  switch (rule.actionType) {
    case 'update_contact_field':
      return `Use update_contact_field to set "${rule.targetFieldKey}" to "${rule.targetValue}". ` +
        `Overwrite existing value: ${rule.overwrite ? 'Yes — always update' : 'No — keep the first value that was set'}`

    case 'update_contact_tags': {
      const tags = (p.tags as string[]) ?? []
      return `Use update_contact_tags to add ${tags.length ? tags.map(t => `"${t}"`).join(', ') : '(no tags configured)'}`
    }
    case 'remove_contact_tags': {
      const tags = (p.tags as string[]) ?? []
      return `Use remove_contact_tags to remove ${tags.length ? tags.map(t => `"${t}"`).join(', ') : '(no tags configured)'}`
    }

    case 'add_to_workflow': {
      const names = (p.workflowNames as string[]) ?? []
      const ids = (p.workflowIds as string[]) ?? []
      if (!ids.length) return 'Use add_to_workflow (no workflow configured — rule will no-op)'
      const listed = names.length === ids.length
        ? names.map((n, i) => `"${n}" (${ids[i]})`).join(', ')
        : ids.join(', ')
      return `Use add_to_workflow to enrol the contact in: ${listed}`
    }
    case 'remove_from_workflow': {
      const names = (p.workflowNames as string[]) ?? []
      const ids = (p.workflowIds as string[]) ?? []
      if (!ids.length) return 'Use remove_from_workflow (no workflow configured — rule will no-op)'
      const listed = names.length === ids.length
        ? names.map((n, i) => `"${n}" (${ids[i]})`).join(', ')
        : ids.join(', ')
      return `Use remove_from_workflow to remove the contact from: ${listed}`
    }

    case 'opportunity_status':
      return `Use mark_opportunity_${(p.status as string) || 'won'} on the contact's active opportunity`
    case 'opportunity_value':
      return `Use upsert_opportunity to set the monetaryValue to ${p.monetaryValue ?? '(not set)'}`

    case 'dnd_channel':
      return `Update the contact to DND on ${p.channel ? `"${p.channel}"` : 'the current conversation channel'} ` +
        `(use update_contact_field with fieldKey "dnd" or a channel-specific key)`

    default:
      return `(unknown action type: ${rule.actionType})`
  }
}

/**
 * Render the rules as a prompt block the agent consults on every turn.
 * Each rule lists its condition, examples, and the specific tool call it
 * should trigger. The agent sees this as part of the system prompt.
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
   → ${describeAction(r)}`
    )
  }).join('\n\n')

  return `\n\n## Detection Rules
On every inbound message, check whether any of the rules below fire. A rule
fires when the contact's message matches the "Fires when" description
semantically — the examples are illustrative, not exhaustive. Paraphrases,
typos, and indirect confirmations should still match.

When a rule fires, call the specified tool with the values listed. Firing
a rule does NOT mean skipping your reply — you still compose your message
normally. Tool calls happen alongside the reply, not instead of it.

${body}`
}

/**
 * Build the fieldKey → overwrite map that executeTool uses to enforce
 * first-answer semantics when the agent writes to rule-governed fields.
 * Only applies to update_contact_field rules; other action types aren't
 * about fields.
 */
export function buildFieldOverwriteMap(rules: LoadedDetectionRule[]): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const r of rules) {
    if (r.actionType === 'update_contact_field' && r.targetFieldKey) {
      map[r.targetFieldKey] = r.overwrite
    }
  }
  return map
}

/**
 * Collect the set of tool names this agent's rules require, so runAgent
 * can auto-enable them on top of what the user toggled. Users shouldn't
 * have to turn on add_to_workflow separately — authoring an add_to_workflow
 * rule is consent.
 */
export function requiredToolsForRules(rules: LoadedDetectionRule[]): string[] {
  const needed = new Set<string>()
  for (const r of rules) {
    switch (r.actionType) {
      case 'update_contact_field':  needed.add('update_contact_field'); break
      case 'update_contact_tags':   needed.add('update_contact_tags'); break
      case 'remove_contact_tags':   needed.add('remove_contact_tags'); break
      case 'add_to_workflow':       needed.add('add_to_workflow'); break
      case 'remove_from_workflow':  needed.add('remove_from_workflow'); break
      case 'opportunity_status':
        // mark_opportunity_won / _lost handle the status transitions; include
        // all three so the agent can pick whichever matches params.status.
        needed.add('mark_opportunity_won')
        needed.add('mark_opportunity_lost')
        needed.add('upsert_opportunity')
        break
      case 'opportunity_value':     needed.add('upsert_opportunity'); break
      case 'dnd_channel':           needed.add('update_contact_field'); break
    }
  }
  return [...needed]
}
