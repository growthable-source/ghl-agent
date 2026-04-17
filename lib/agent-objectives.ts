import { db } from './db'

export interface ObjectiveGoal {
  name: string
  goalType: string
  value: string | null
  isPrimary: boolean
  priority: number
  aggressiveness: string          // "soft" | "moderate" | "aggressive"
  triggerPhrases: string[]
  preferredTool: string | null
  instruction: string | null
  maxTurns: number | null
}

const GOAL_TYPE_VERB: Record<string, string> = {
  appointment_booked:   'book an appointment with the contact',
  opportunity_created:  'create an opportunity for the contact',
  opportunity_moved:    'move the opportunity to the target stage',
  tag_added:            'add the target tag to the contact',
  custom:               'complete the custom action',
}

const GOAL_TYPE_TOOL: Record<string, string> = {
  appointment_booked:   'book_appointment',
  opportunity_created:  'create_opportunity',
  opportunity_moved:    'move_opportunity_stage',
  tag_added:            'update_contact_tags',
}

/**
 * Build the OBJECTIVES block that gets injected at the TOP of the system
 * prompt. This is the highest-priority instruction the agent receives —
 * it tells the model what a successful conversation looks like and WHICH
 * TOOL to reach for, not just that the tool exists.
 *
 * When the inbound message matches any trigger phrase, we surface that
 * match to the model so it can act immediately.
 */
export function buildObjectivesBlock(goals: ObjectiveGoal[], inboundMessage: string = ''): string {
  const active = goals.filter(g => g.triggerPhrases !== undefined) // defensive for pre-migration rows
  if (active.length === 0) return ''

  // Sort: primary first, then by priority (lower number = more important)
  const sorted = [...active].sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1
    return a.priority - b.priority
  })

  const lowered = inboundMessage.toLowerCase()
  const triggered = sorted.filter(g =>
    (g.triggerPhrases || []).some(p => p.trim() && lowered.includes(p.trim().toLowerCase()))
  )

  const lines: string[] = []
  lines.push('\n\n## PRIMARY OBJECTIVES')
  lines.push('Your success is measured by completing these objectives. Reach for the specified tool decisively — do NOT stall with extra conversation when the user has already expressed intent.')

  for (const goal of sorted) {
    const verb = GOAL_TYPE_VERB[goal.goalType] || 'complete the goal'
    const tool = goal.preferredTool || GOAL_TYPE_TOOL[goal.goalType]
    const tag = goal.isPrimary ? '[PRIMARY]' : '[Secondary]'

    lines.push(`\n### ${tag} ${goal.name}`)
    lines.push(`Definition of success: ${verb}${goal.value ? ` (value: "${goal.value}")` : ''}.`)

    if (tool) {
      const directive = goal.aggressiveness === 'aggressive'
        ? `REACH FOR the \`${tool}\` tool as soon as the contact expresses any intent related to this objective. Do not ask more than one qualifying question before trying.`
        : goal.aggressiveness === 'soft'
        ? `When the contact clearly wants to move forward, use the \`${tool}\` tool to complete the objective.`
        : `When the contact expresses intent related to this objective, confirm briefly then use the \`${tool}\` tool. Two short qualifying questions maximum before acting.`
      lines.push(directive)
    }

    if (goal.maxTurns) {
      lines.push(`Target: achieve this within ${goal.maxTurns} turns or fewer.`)
    }

    if (goal.triggerPhrases && goal.triggerPhrases.length > 0) {
      lines.push(`Trigger phrases — when the contact says any of these, pursue this objective IMMEDIATELY: ${goal.triggerPhrases.map(p => `"${p}"`).join(', ')}.`)
    }

    if (goal.instruction) {
      lines.push(`How to pursue: ${goal.instruction.trim()}`)
    }
  }

  // Callout for matched triggers in this specific message
  if (triggered.length > 0) {
    lines.push('\n### ⚡ OBJECTIVE TRIGGERED')
    lines.push(`The current inbound message matches trigger phrases for: ${triggered.map(t => `"${t.name}"`).join(', ')}.`)
    lines.push('Act on that objective in this turn. Do not punt with an open-ended question — take the action.')
  }

  return lines.join('\n')
}

/**
 * Convenience loader — fetches active goals for an agent and builds the block.
 * Returns empty string on any error (pre-migration DB, missing table, etc).
 */
export async function buildObjectivesBlockForAgent(agentId: string, inboundMessage: string = ''): Promise<string> {
  try {
    const goals = await db.agentGoal.findMany({
      where: { agentId, isActive: true },
      select: {
        name: true, goalType: true, value: true, isPrimary: true, priority: true,
        aggressiveness: true, triggerPhrases: true, preferredTool: true,
        instruction: true, maxTurns: true,
      },
    }) as any as ObjectiveGoal[]
    return buildObjectivesBlock(goals, inboundMessage)
  } catch {
    return ''
  }
}
