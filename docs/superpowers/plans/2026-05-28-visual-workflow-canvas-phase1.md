# Visual Workflow Canvas — Phase 1 (Foundation) Implementation Plan

**Goal:** Read-only React Flow canvas at `/dashboard/[wsId]/agents/[agentId]/flow` renders the agent's full configuration as a node graph with dagre auto-layout. No editing, no toggle, no badges yet — just the foundational rendering layer.

**Spec:** `docs/superpowers/specs/2026-05-28-visual-workflow-canvas-design.md`

---

## File structure

**New:**
- `prisma/migrations-legacy/manual_agent_node_layout.sql` — hand-run SQL
- `lib/agent/flow/types.ts` — `FlowNode`, `FlowEdge`, `NodeType`, `FlowResponse`
- `lib/agent/flow/build.ts` — `buildAgentFlow(agentId)` — pulls all relations, emits FlowResponse
- `lib/agent/flow/layout.ts` — dagre wrapper, returns computed positions
- `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/route.ts` — GET
- `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/reset-layout/route.ts` — POST
- `components/dashboard/AgentFlowCanvas.tsx` — React Flow renderer
- `components/dashboard/flow/node-types.tsx` — custom node component per type
- `app/dashboard/[workspaceId]/agents/[agentId]/flow/page.tsx` — page mount + breadcrumb

**Modified:**
- `prisma/schema.prisma` — `AgentNodeLayout` model + Agent relation + `Agent.viewMode`
- `package.json` — `reactflow` + `@dagrejs/dagre`

---

## Tasks

### T1: Schema + SQL

- Create `prisma/migrations-legacy/manual_agent_node_layout.sql` with the SQL block from the spec.
- Add `AgentNodeLayout` model to `prisma/schema.prisma` (near other Agent-relation models like `AgentToolConfig`).
- Add `viewMode String @default("simple")` to `model Agent`.
- Add `nodeLayouts AgentNodeLayout[]` relation to `Agent`.
- Run `npx prisma generate`.
- DO NOT run SQL — Ryan runs by hand.
- Commit: `schema: AgentNodeLayout + Agent.viewMode (Phase Adv-1)`

### T2: NPM deps

- `npm install reactflow @dagrejs/dagre`
- Commit: `deps: reactflow + @dagrejs/dagre for visual workflow canvas`

### T3: Flow types

Create `lib/agent/flow/types.ts`:

```ts
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
  id: string                // matches nodeKey scheme
  type: NodeType
  data: {
    label: string
    sourceId?: string       // FK to underlying row
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
```

Commit: `flow: shared types for canvas API`

### T4: Layout helper

Create `lib/agent/flow/layout.ts`:

```ts
import dagre from '@dagrejs/dagre'
import type { FlowNode, FlowEdge } from './types'

const NODE_WIDTH = 220
const NODE_HEIGHT = 60

/**
 * dagre-driven layout. Top-down hierarchical, suitable for trigger →
 * filter → tool → endpoint flows. Positions returned in React Flow's
 * coordinate space.
 *
 * Pre-existing positions (from AgentNodeLayout overrides) are applied
 * AFTER dagre — the override wins for any node where it's set.
 */
export function autoLayout(
  nodes: FlowNode[],
  edges: FlowEdge[],
  overrides: Map<string, { x: number; y: number }>,
): FlowNode[] {
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 60, ranksep: 100 })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  return nodes.map(n => {
    const override = overrides.get(n.id)
    if (override) return { ...n, position: override }
    const dagreNode = g.node(n.id)
    return {
      ...n,
      position: {
        x: dagreNode.x - NODE_WIDTH / 2,
        y: dagreNode.y - NODE_HEIGHT / 2,
      },
    }
  })
}
```

Commit: `flow: dagre auto-layout wrapper`

### T5: Flow builder

Create `lib/agent/flow/build.ts`. This is the heaviest file — it pulls every agent relation and emits nodes/edges.

Key implementation notes:
- Single Prisma `findUnique` with all relations included
- Node-key scheme per spec (`channel:SMS`, `tool:book_appointment`, etc.)
- For each tool, check the catalog for `enforcement: 'enforced'` and emit a `gate` node + double-purple edge
- For tools with non-default `onFailure`, emit an edge to the corresponding `failure:*` endpoint
- For triggers, one node per active `ChannelDeployment` plus one per `AgentTrigger`
- Single entry "fan-in" not needed — triggers connect directly to filters
- Filters → tools edges: an agent's enabled tools branch from each routing filter; for simplicity in Phase 1, every filter connects to every tool (we tighten later with per-rule channel scoping)
- Load `AgentNodeLayout` rows and pass to `autoLayout` as overrides

Commit: `flow: buildAgentFlow — collects all agent relations into nodes + edges`

### T6: GET + POST endpoints

Create `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'
import { buildAgentFlow } from '@/lib/agent/flow/build'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const flow = await buildAgentFlow(agentId)
  return NextResponse.json(flow)
}
```

Create `app/api/workspaces/[workspaceId]/agents/[agentId]/flow/reset-layout/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; agentId: string }> }

export async function POST(_req: NextRequest, { params }: Params) {
  const { workspaceId, agentId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const agent = await db.agent.findFirst({
    where: { id: agentId, workspaceId },
    select: { id: true },
  })
  if (!agent) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  await db.agentNodeLayout.deleteMany({ where: { agentId } })
  return NextResponse.json({ ok: true })
}
```

Commit: `flow: GET endpoint + POST reset-layout endpoint`

### T7: Node type components

Create `components/dashboard/flow/node-types.tsx`. One small functional component per `NodeType`. Each renders the labelled, shape-appropriate node with the right colour token.

Pattern (one example):

```tsx
import { Handle, Position } from 'reactflow'

export function ChannelTriggerNode({ data }: { data: any }) {
  return (
    <div
      className="rounded-full px-4 py-2 text-sm font-medium border-2"
      style={{
        background: 'var(--accent-coral-bg, #fff5f3)',
        borderColor: 'var(--accent-coral, #fa4d2e)',
        color: 'var(--accent-coral, #fa4d2e)',
        minWidth: 160,
      }}
    >
      <Handle type="target" position={Position.Left} />
      <span>{data.label}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

// ... ToolNode, FilterNode, GateNode, etc.
```

Export a `nodeTypes` map for React Flow consumption.

Commit: `flow: per-type node components + colour-coded styling`

### T8: AgentFlowCanvas component

Create `components/dashboard/AgentFlowCanvas.tsx`. Client component, mounts React Flow, fetches the GET endpoint, wires up node types.

```tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeTypes } from './flow/node-types'
import type { FlowResponse } from '@/lib/agent/flow/types'

export function AgentFlowCanvas({ workspaceId, agentId }: { workspaceId: string; agentId: string }) {
  const [flow, setFlow] = useState<FlowResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/flow`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = await res.json()
      setFlow(data)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load flow')
    }
  }, [workspaceId, agentId])

  useEffect(() => { void load() }, [load])

  async function reset() {
    if (!confirm('Reset all positions to auto-layout? This can\'t be undone.')) return
    setResetting(true)
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/flow/reset-layout`, { method: 'POST' })
      await load()
    } finally {
      setResetting(false)
    }
  }

  if (error) return <div className="p-4 text-sm" style={{ color: 'var(--accent-red)' }}>{error}</div>
  if (!flow) return <div className="p-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading flow…</div>

  const nodes: Node[] = flow.nodes.map(n => ({
    id: n.id,
    type: n.type,
    data: n.data,
    position: n.position,
  }))
  const edges: Edge[] = flow.edges.map(e => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: 'smoothstep',
    label: e.label,
    style: edgeStyleFor(e.type),
    animated: e.type === 'gated',
  }))

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="text-xs font-medium px-2.5 py-1 rounded border"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)', color: 'var(--text-primary)' }}
        >
          {resetting ? 'Resetting…' : 'Reset layout'}
        </button>
        <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          {flow.nodes.length} node{flow.nodes.length === 1 ? '' : 's'} · {flow.edges.length} edge{flow.edges.length === 1 ? '' : 's'}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--border)" />
          <Controls position="bottom-right" />
          <MiniMap position="bottom-left" zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  )
}

function edgeStyleFor(type: 'default' | 'onFailure' | 'gated'): React.CSSProperties {
  switch (type) {
    case 'onFailure': return { stroke: 'var(--accent-red)', strokeDasharray: '6 4' }
    case 'gated': return { stroke: 'var(--accent-purple, #7c3aed)', strokeWidth: 2 }
    default: return { stroke: 'var(--border)' }
  }
}
```

Commit: `flow: AgentFlowCanvas client component`

### T9: Page mount

Create `app/dashboard/[workspaceId]/agents/[agentId]/flow/page.tsx`:

```tsx
'use client'

import { useParams } from 'next/navigation'
import { AgentFlowCanvas } from '@/components/dashboard/AgentFlowCanvas'

export default function AgentFlowPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column' }}>
      <AgentFlowCanvas workspaceId={workspaceId} agentId={agentId} />
    </div>
  )
}
```

Commit: `flow: page mount at /agents/[agentId]/flow`

### T10: Verify + push

- `npx vitest run` — 141 still passing (no new tests in Phase 1)
- `npx prisma generate` — clean
- `git push origin main`

---

## What's NOT in Phase 1

- View mode toggle in agent header (Phase 2)
- Hide tabs when in advanced mode (Phase 2)
- Drag-to-save (Phase 3)
- Side panel editor (Phase 4)
- Validation badges (Phase 5)

Phase 1 ships as a standalone explorable canvas at `/flow`. Users can navigate to it directly, see their agent visualized, and reset the layout. Subsequent phases build on this foundation.
