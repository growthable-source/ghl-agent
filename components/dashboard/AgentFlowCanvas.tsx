'use client'

/**
 * AgentFlowCanvas — the client-side React Flow renderer for the visual
 * workflow canvas (Phase Adv-1 → Adv-3).
 *
 * Fetches `GET /api/workspaces/{wsId}/agents/{agentId}/flow` and mounts
 * a React Flow viewport with our custom node types. The toolbar carries
 * a Reset-layout button (opens a confirm modal that calls the sibling
 * POST endpoint) and a node / edge count summary.
 *
 * Phase 3 — drag-to-persist:
 *   • onNodeDragStop captures the new position into a pending Map
 *   • a 500ms debounce batches multi-node moves into a single PATCH
 *   • beforeunload + unmount flushes pending writes via sendBeacon so
 *     dragging then immediately closing the tab doesn't lose work
 *   • toolbar shows a transient "Saving layout…" / "Layout saved" hint
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { nodeTypes } from './flow/node-types'
import type { FlowResponse } from '@/lib/agent/flow/types'

const SAVE_DEBOUNCE_MS = 500

export function AgentFlowCanvas({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [flow, setFlow] = useState<FlowResponse | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<Node['data']>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [error, setError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [layoutSaveStatus, setLayoutSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const pendingPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushLayoutPatch = useCallback(async () => {
    if (pendingPositionsRef.current.size === 0) return
    const positions = Array.from(pendingPositionsRef.current.entries()).map(([nodeKey, { x, y }]) => ({ nodeKey, x, y }))
    pendingPositionsRef.current.clear()
    setLayoutSaveStatus('saving')
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/flow/layout`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ positions }),
      })
      setLayoutSaveStatus('saved')
      setTimeout(() => setLayoutSaveStatus('idle'), 1500)
    } catch {
      // Drop silently — next drag re-batches.
      setLayoutSaveStatus('idle')
    }
  }, [workspaceId, agentId])

  const handleNodeDragStop = useCallback((_e: React.MouseEvent | unknown, node: Node) => {
    pendingPositionsRef.current.set(node.id, { x: node.position.x, y: node.position.y })
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => { void flushLayoutPatch() }, SAVE_DEBOUNCE_MS)
  }, [flushLayoutPatch])

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/flow`,
        { cache: 'no-store' },
      )
      if (!res.ok) throw new Error(`Failed (${res.status})`)
      const data = (await res.json()) as FlowResponse
      setFlow(data)
      setNodes(data.nodes.map(n => ({
        id: n.id,
        type: n.type,
        data: n.data,
        position: n.position,
      })))
      setEdges(data.edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'smoothstep',
        label: e.label,
        style: edgeStyleFor(e.type),
        animated: e.type === 'gated',
      })))
      setError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load flow'
      setError(msg)
    }
  }, [workspaceId, agentId, setNodes, setEdges])

  useEffect(() => {
    void load()
  }, [load])

  // Flush on unmount + window unload — dragging then alt-tabbing away shouldn't lose work.
  useEffect(() => {
    const onUnload = () => {
      if (pendingPositionsRef.current.size > 0) {
        const positions = Array.from(pendingPositionsRef.current.entries())
          .map(([nodeKey, { x, y }]) => ({ nodeKey, x, y }))
        navigator.sendBeacon(
          `/api/workspaces/${workspaceId}/agents/${agentId}/flow/layout`,
          new Blob([JSON.stringify({ positions })], { type: 'application/json' }),
        )
      }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      void flushLayoutPatch()
    }
  }, [workspaceId, agentId, flushLayoutPatch])

  async function confirmReset() {
    setResetting(true)
    try {
      await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/flow/reset-layout`,
        { method: 'POST' },
      )
      // Drop any in-flight pending writes — they'd undo the reset.
      pendingPositionsRef.current.clear()
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      await load()
      setResetDialogOpen(false)
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

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-3 px-4 py-2 border-b"
        style={{ borderColor: 'var(--border, #e5e7eb)', background: 'var(--surface, #ffffff)' }}
      >
        <button
          type="button"
          onClick={() => setResetDialogOpen(true)}
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
        {layoutSaveStatus === 'saving' && (
          <span className="text-xs" style={{ color: 'var(--text-tertiary, #6b7280)' }}>Saving layout…</span>
        )}
        {layoutSaveStatus === 'saved' && (
          <span className="text-xs" style={{ color: 'var(--accent-emerald, #059669)' }}>Layout saved</span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={handleNodeDragStop}
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

      {resetDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-layout-title"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
            padding: 16,
          }}
          onClick={() => { if (!resetting) setResetDialogOpen(false) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 8,
              padding: 20,
              width: '100%',
              maxWidth: 440,
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3
              id="reset-layout-title"
              style={{ fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 12 }}
            >
              Reset layout?
            </h3>
            <p style={{ fontSize: 13, lineHeight: 1.5, margin: 0, color: 'var(--text-secondary, #4b5563)' }}>
              Auto-layout will reposition every node from scratch. Any manual positions you&rsquo;ve dragged will be lost. This can&rsquo;t be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
              <button
                type="button"
                onClick={() => setResetDialogOpen(false)}
                disabled={resetting}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--bg, #fff)',
                  color: 'var(--fg, #111827)',
                  borderRadius: 6,
                  cursor: resetting ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void confirmReset() }}
                disabled={resetting}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'var(--accent-red, #dc2626)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: resetting ? 'not-allowed' : 'pointer',
                }}
              >
                {resetting ? 'Resetting…' : 'Reset'}
              </button>
            </div>
          </div>
        </div>
      )}
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
