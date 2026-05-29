import dagre from '@dagrejs/dagre'
import type { FlowNode, FlowEdge } from './types'

const NODE_WIDTH = 220
const NODE_HEIGHT = 60

/**
 * dagre-driven layout. Left-to-right hierarchical, suitable for trigger →
 * filter → tool → endpoint flows. Positions returned in React Flow's
 * coordinate space (top-left origin).
 *
 * Pre-existing positions (from AgentNodeLayout overrides) are applied
 * AFTER dagre — the override wins for any node where it's set, so a
 * user who drags a single node keeps that placement while the rest of
 * the graph stays auto-laid-out.
 */
export function autoLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  overrides: Map<string, { x: number; y: number }>,
): FlowNode[] {
  const g = new dagre.graphlib.Graph()
  // Looser separation than dagre's defaults so edge labels + corner
  // badges have breathing room. ranksep controls horizontal gap between
  // layers (rankdir=LR), nodesep controls vertical gap between siblings
  // in the same layer. Phase 5 bump from 100/60 → 120/80 after tangled
  // output on agents with many parallel filters/tools.
  g.setGraph({
    rankdir: 'LR',
    nodesep: 80,
    ranksep: 120,
    marginx: 24,
    marginy: 24,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  return nodes.map(n => {
    const override = overrides.get(n.id)
    if (override) return { ...n, position: override }
    const dagreNode = g.node(n.id)
    if (!dagreNode) {
      // Disconnected node — dagre returns undefined. Park it at (0,0)
      // and let the override / drag layer handle it later.
      return { ...n, position: { x: 0, y: 0 } }
    }
    return {
      ...n,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
    }
  })
}
