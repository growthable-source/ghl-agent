/**
 * Co-Pilot structured workflows (P0-7).
 *
 * A workflow is procedural knowledge expressed as ordered steps with
 * machine-checkable completion predicates — NOT free text the model
 * paraphrases. The co-pilot tracks where the user is by re-reading
 * the workspace setup state (the get_workspace_setup_state tool) and
 * comparing against each step's `doneWhen` predicate. Off-path
 * detection falls out of the same mechanism: if the user's screen
 * shows something unrelated to the current step, the system prompt
 * instructs the model to redirect.
 *
 * v0 ships exactly ONE workflow (spec scope): publish-first-agent —
 * the highest-friction onboarding step we see in real accounts.
 * Steps are deliberately coarse (page-level, not click-level) because
 * the model grounds fine detail from the live screen, not from here.
 *
 * Predicates are pure functions over WorkspaceSetupState so they're
 * unit-testable and double as the auto task_success evaluation at
 * session end (P0-10).
 */

import type { WorkspaceSetupState } from './setup-state'

export interface WorkflowStep {
  id: string
  title: string
  /** What the co-pilot should help the user accomplish in this step. */
  guidance: string
  /** Machine check: is this step already done for the workspace? */
  doneWhen: (s: WorkspaceSetupState) => boolean
}

export interface CopilotWorkflow {
  key: string
  title: string
  /** Goal state for the whole workflow — drives task_success. */
  goal: string
  goalReached: (s: WorkspaceSetupState) => boolean
  steps: WorkflowStep[]
}

export const PUBLISH_FIRST_AGENT: CopilotWorkflow = {
  key: 'publish-first-agent',
  title: 'Publish your first AI agent',
  goal: 'An active agent exists with at least one channel deployed, so it can actually answer customers.',
  goalReached: s => s.activeAgentCount > 0 && s.deployedChannels.length > 0,
  steps: [
    {
      id: 'create-agent',
      title: 'Create an agent',
      guidance:
        'Help the user create their first agent from the Text agents page ' +
        '("+ New Agent"). The wizard walks through use case, personality, ' +
        'and knowledge. Any template is fine — they can change everything later.',
      doneWhen: s => s.agentCount > 0,
    },
    {
      id: 'add-knowledge',
      title: 'Give the agent something to know',
      guidance:
        'Help the user add at least one knowledge entry or connect a ' +
        'knowledge collection on the agent’s Knowledge tab, so the agent ' +
        'can answer real questions instead of improvising.',
      doneWhen: s => s.knowledgeEntryCount > 0,
    },
    {
      id: 'deploy-channel',
      title: 'Deploy to a channel',
      guidance:
        'Help the user deploy the agent to at least one channel (Live Chat ' +
        'is the fastest to test; SMS/WhatsApp/Email need a connected CRM ' +
        'location). The channel toggles live on the agent’s settings.',
      doneWhen: s => s.deployedChannels.length > 0,
    },
    {
      id: 'activate',
      title: 'Make sure the agent is active',
      guidance:
        'Confirm the agent’s status toggle is on (active). An agent with ' +
        'channels but toggled off still answers nothing.',
      doneWhen: s => s.activeAgentCount > 0,
    },
  ],
}

const WORKFLOWS: Record<string, CopilotWorkflow> = {
  [PUBLISH_FIRST_AGENT.key]: PUBLISH_FIRST_AGENT,
}

export const DEFAULT_WORKFLOW_KEY = PUBLISH_FIRST_AGENT.key

export function getWorkflow(key: string | null | undefined): CopilotWorkflow {
  return (key && WORKFLOWS[key]) || PUBLISH_FIRST_AGENT
}

/** Index of the first incomplete step (or steps.length when all done). */
export function currentStepIndex(workflow: CopilotWorkflow, s: WorkspaceSetupState): number {
  const idx = workflow.steps.findIndex(step => !step.doneWhen(s))
  return idx === -1 ? workflow.steps.length : idx
}

/** Render workflow progress as compact text for the system prompt / tool results. */
export function describeWorkflowProgress(workflow: CopilotWorkflow, s: WorkspaceSetupState): string {
  const lines = workflow.steps.map((step, i) => {
    const done = step.doneWhen(s)
    return `${i + 1}. [${done ? 'DONE' : 'TODO'}] ${step.title} — ${step.guidance}`
  })
  const goal = workflow.goalReached(s) ? 'GOAL REACHED' : 'goal not yet reached'
  return `Workflow: ${workflow.title} (${goal})\nGoal: ${workflow.goal}\n${lines.join('\n')}`
}
