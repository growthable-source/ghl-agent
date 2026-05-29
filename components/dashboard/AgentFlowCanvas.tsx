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
import { edgeTypes } from './flow/edge-types'
import type { FlowNode, FlowResponse } from '@/lib/agent/flow/types'
import { AgentFlowSidePanel } from './flow/AgentFlowSidePanel'
import type { EditorHandle } from './flow/editors/types'
import { ToolNodeEditor } from './flow/editors/ToolNodeEditor'
import { RoutingRuleEditor } from './flow/editors/RoutingRuleEditor'
import { StopConditionEditor } from './flow/editors/StopConditionEditor'
import { CrmTriggerEditor } from './flow/editors/CrmTriggerEditor'
import { ChannelDeploymentEditor } from './flow/editors/ChannelDeploymentEditor'
import { WorkingHoursEditor } from './flow/editors/WorkingHoursEditor'
import { FollowUpEditor } from './flow/editors/FollowUpEditor'

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

  // Side-panel state — which node the user clicked, plus dirty/saving so
  // the panel footer's Save/Cancel buttons can reflect the editor's state.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [editorDirty, setEditorDirty] = useState(false)
  const [editorSaving, setEditorSaving] = useState(false)
  const editorRef = useRef<EditorHandle | null>(null)

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

  // Clicking a node opens the side panel anchored to that node id.
  // If the user already had unsaved edits on a different node, we
  // run them through the panel's close-confirm flow before switching.
  const handleNodeClick = useCallback((_e: React.MouseEvent, node: Node) => {
    if (selectedNodeId === node.id) return
    if (editorDirty && typeof window !== 'undefined') {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    setSelectedNodeId(node.id)
    setEditorDirty(false)
    setEditorSaving(false)
    editorRef.current = null
  }, [selectedNodeId, editorDirty])

  function closePanel() {
    setSelectedNodeId(null)
    setEditorDirty(false)
    setEditorSaving(false)
    editorRef.current = null
  }

  async function handleFooterSave() {
    if (!editorRef.current) return
    const ok = await editorRef.current.save()
    if (ok) {
      // Refetch the flow so any visible side effect of the save (a tool
      // being disabled, a stop condition being removed, …) shows up.
      await load()
    }
  }

  function handleFooterCancel() {
    if (!editorRef.current) {
      closePanel()
      return
    }
    if (editorDirty && typeof window !== 'undefined') {
      if (!window.confirm('Discard unsaved changes?')) return
    }
    editorRef.current.cancel()
    closePanel()
  }

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
        // Edges with a label go through our custom `labeled` edge so we
        // can truncate long text with a hover tooltip. Plain edges keep
        // the default smoothstep renderer.
        type: e.label ? 'labeled' : 'smoothstep',
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
          onNodeClick={handleNodeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} color="var(--border, #e5e7eb)" />
          <Controls position="bottom-right" />
          <MiniMap position="bottom-left" zoomable pannable />
        </ReactFlow>
      </div>

      {(() => {
        const selectedNode = selectedNodeId
          ? flow.nodes.find(n => n.id === selectedNodeId) ?? null
          : null
        if (!selectedNode) return null
        return (
          <AgentFlowSidePanel
            open={true}
            onClose={closePanel}
            title={panelTitleFor(selectedNode)}
            unsavedChanges={editorDirty}
            footer={
              <>
                <button
                  type="button"
                  onClick={handleFooterCancel}
                  disabled={editorSaving}
                  className="text-xs font-medium px-3 py-1.5 rounded border"
                  style={{
                    borderColor: 'var(--border, #e5e7eb)',
                    background: 'var(--surface, #ffffff)',
                    color: 'var(--text-secondary, #4b5563)',
                    cursor: editorSaving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => { void handleFooterSave() }}
                  disabled={!editorDirty || editorSaving}
                  className="text-xs font-semibold px-3 py-1.5 rounded"
                  style={{
                    background: editorDirty && !editorSaving ? 'var(--accent-primary, #2563eb)' : 'var(--surface-tertiary, #e5e7eb)',
                    color: editorDirty && !editorSaving ? 'var(--btn-primary-text, #fff)' : 'var(--text-tertiary, #6b7280)',
                    cursor: editorSaving ? 'wait' : (!editorDirty ? 'not-allowed' : 'pointer'),
                  }}
                >
                  {editorSaving ? 'Saving…' : 'Save'}
                </button>
              </>
            }
          >
            {renderEditorFor(selectedNode, {
              workspaceId,
              agentId,
              editorRef,
              onSaved: () => { void load() },
              onDirtyChange: setEditorDirty,
              onSavingChange: setEditorSaving,
            })}
          </AgentFlowSidePanel>
        )
      })()}

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

/**
 * Title shown in the side-panel header for a given flow node. Falls back
 * to the node's own label when we don't have a more specific name.
 */
function panelTitleFor(node: FlowNode): string {
  switch (node.type) {
    case 'tool': return `Tool · ${node.data.label}`
    case 'routingRule': return `Routing rule · ${node.data.label}`
    case 'stopCondition': return `Stop condition · ${node.data.label}`
    case 'crmTrigger': return `CRM trigger · ${node.data.label}`
    case 'channelTrigger': return `Channel · ${node.data.label}`
    case 'workingHours': return 'Working hours'
    case 'followUp': return `Follow-up · ${node.data.label}`
    default: return node.data.label
  }
}

/**
 * Dispatch the side-panel body for a given node. Each branch mounts the
 * editor specific to the node's underlying entity. T2 ships stubs only —
 * real editors land in T3-T9 as separate commits.
 */
function renderEditorFor(
  node: FlowNode,
  ctx: {
    workspaceId: string
    agentId: string
    editorRef: React.MutableRefObject<EditorHandle | null>
    onSaved: () => void
    onDirtyChange: (dirty: boolean) => void
    onSavingChange: (saving: boolean) => void
  },
): React.ReactNode {
  // The FK to the underlying row when applicable.
  // For tools, the catalog name is encoded in the node id as "tool:<name>".
  const colonIdx = node.id.indexOf(':')
  const idTail = colonIdx >= 0 ? node.id.slice(colonIdx + 1) : node.id
  const sourceId = node.data.sourceId ?? idTail

  switch (node.type) {
    case 'tool':
      return (
        <ToolNodeEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          toolName={idTail}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'routingRule':
      return (
        <RoutingRuleEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          routingRuleId={sourceId}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'stopCondition':
      return (
        <StopConditionEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          stopConditionId={sourceId}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'crmTrigger':
      return (
        <CrmTriggerEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          triggerId={sourceId}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'channelTrigger':
      return (
        <ChannelDeploymentEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          channel={idTail}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'workingHours':
      return (
        <WorkingHoursEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    case 'followUp':
      return (
        <FollowUpEditor
          ref={ctx.editorRef}
          workspaceId={ctx.workspaceId}
          agentId={ctx.agentId}
          followUpId={sourceId}
          onSaved={ctx.onSaved}
          onDirtyChange={ctx.onDirtyChange}
          onSavingChange={ctx.onSavingChange}
        />
      )
    default:
      return <NotImplementedStub label={`${node.type}: no editor yet`} />
  }
}

function NotImplementedStub({ label }: { label: string }) {
  return (
    <div
      className="text-xs rounded-md p-3"
      style={{ background: 'var(--surface-secondary, #f3f4f6)', color: 'var(--text-tertiary, #6b7280)' }}
    >
      {label} — not yet implemented.
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
