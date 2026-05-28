'use client'

/**
 * AgentFlowCanvas — the client-side React Flow renderer for the visual
 * workflow canvas (Phase Adv-1).
 *
 * Fetches `GET /api/workspaces/{wsId}/agents/{agentId}/flow` and mounts
 * a React Flow viewport with our custom node types. The toolbar carries
 * a Reset-layout button (calls the sibling POST endpoint) and a node /
 * edge count summary.
 *
 * Read-only in Phase 1 — no drag-to-save, no side panel, no badges.
 * The page mount provides a full-bleed container.
 */

import { useEffect, useState, useCallback } from 'react'
import ReactFlow, { Background, Controls, MiniMap, type Node, type Edge } from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeTypes } from './flow/node-types'
import type { FlowResponse } from '@/lib/agent/flow/types'

export function AgentFlowCanvas({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [flow, setFlow] = useState<FlowResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/flow`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = (await res.json()) as FlowResponse
      setFlow(data)
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load flow'
      setError(msg)
    }
  }, [workspaceId, agentId])

  useEffect(() => {
    void load()
  }, [load])

  async function reset() {
    if (!confirm('Reset all positions to auto-layout? This can\'t be undone.')) return
    setResetting(true)
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/flow/reset-layout`,
        { method: 'POST' },
      )
      await load()
    } finally {
      setResetting(false)
    }
  }

  if (error) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--accent-red, #dc2626)' }}>
        {error}
      </div>
    )
  }
  if (!flow) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--text-tertiary, #6b7280)' }}>
        Loading flow…
      </div>
    )
  }

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
        style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface, #ffffff)' }}
      >
        <button
          type="button"
          onClick={reset}
          disabled={resetting}
          className="text-xs font-medium px-2.5 py-1 rounded border"
          style={{
            borderColor: 'var(--border, #e5e7eb)',
            background: 'var(--surface, #ffffff)',
            color: 'var(--text-primary, #111827)',
            cursor: resetting ? 'wait' : 'pointer',
          }}
        >
          {resetting ? 'Resetting…' : 'Reset layout'}
        </button>
        <span className="text-xs" style={{ color: 'var(--text-tertiary, #6b7280)' }}>
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
          <Background gap={20} size={1} color="var(--border, #e5e7eb)" />
          <Controls position="bottom-right" />
          <MiniMap position="bottom-left" zoomable pannable />
        </ReactFlow>
      </div>
    </div>
  )
}

function edgeStyleFor(type: 'default' | 'onFailure' | 'gated'): React.CSSProperties {
  switch (type) {
    case 'onFailure':
      return { stroke: 'var(--accent-red, #dc2626)', strokeDasharray: '6 4' }
    case 'gated':
      return { stroke: 'var(--accent-purple, #7c3aed)', strokeWidth: 2 }
    default:
      return { stroke: 'var(--border, #9ca3af)' }
  }
}
