/**
 * Walks an Agent plus its directly-owned children (StopCondition, AgentTrigger)
 * and emits one tuple per CRM-referenced resource ID. Empty-string IDs are
 * treated as unset and skipped.
 *
 * Adding a new reference site (e.g. a new column on Agent, or a new child
 * model) means appending one block here. The rest of the framework picks
 * it up automatically as long as the resourceType has a registered validator.
 */

export interface AgentReference {
  resourceType: string
  resourceId: string
  sourceField: string
}

interface CollectableStopCondition {
  id: string
  enrollWorkflowId: string | null
  removeWorkflowId: string | null
}

interface CollectableAgent {
  id: string
  calendarId: string | null
  stopConditions: CollectableStopCondition[]
  triggers: unknown[]
}

export function collectAgentReferences(agent: CollectableAgent): AgentReference[] {
  const refs: AgentReference[] = []

  if (agent.calendarId && agent.calendarId.length > 0) {
    refs.push({
      resourceType: 'calendar',
      resourceId: agent.calendarId,
      sourceField: 'Agent.calendarId',
    })
  }

  for (const sc of agent.stopConditions) {
    if (sc.enrollWorkflowId && sc.enrollWorkflowId.length > 0) {
      refs.push({
        resourceType: 'workflow',
        resourceId: sc.enrollWorkflowId,
        sourceField: `StopCondition[${sc.id}].enrollWorkflowId`,
      })
    }
    if (sc.removeWorkflowId && sc.removeWorkflowId.length > 0) {
      refs.push({
        resourceType: 'workflow',
        resourceId: sc.removeWorkflowId,
        sourceField: `StopCondition[${sc.id}].removeWorkflowId`,
      })
    }
  }

  // AgentTriggers don't currently have workflow ID fields — append here
  // if/when they do.

  return refs
}
