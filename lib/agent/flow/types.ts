/**
 * Shared types for the Visual Workflow Canvas (Phase Adv-1).
 *
 * The GET /flow endpoint returns a FlowResponse — the React Flow
 * renderer maps it 1:1 onto its own `Node` / `Edge` shapes. Keeping
 * our own types lets us evolve labels, badges, and edge semantics
 * without leaking React Flow's API into the server.
 */

export type NodeType =
  | 'channelTrigger'
  | 'crmTrigger'
  | 'routingRule'
  | 'workingHours'
  | 'stopCondition'
  | 'tool'
  | 'gate'
  | 'failureEndpoint'
  | 'pauseEndpoint'
  | 'handoverEndpoint'
  | 'followUp'
  | 'playbookRule'

export interface FlowNode {
  /** Stable nodeKey — e.g. "tool:book_appointment", "channel:SMS". */
  id: string
  type: NodeType
  data: {
    label: string
    /** FK to the underlying row when applicable (RoutingRule id, etc.). */
    sourceId?: string
    meta?: Record<string, unknown>
    badges?: Array<{ kind: 'broken' | 'warning'; text: string }>
  }
  position: { x: number; y: number }
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  type: 'default' | 'onFailure' | 'gated'
  label?: string
  data?: { ruleId?: string }
}

export interface FlowResponse {
  nodes: FlowNode[]
  edges: FlowEdge[]
  viewMode: 'simple' | 'advanced'
}
