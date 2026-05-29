/**
 * Shared shape for every side-panel editor used by AgentFlowCanvas.
 *
 * Each editor is its own component (ToolNodeEditor, RoutingRuleEditor,
 * etc.), but they all expose the same imperative handle so the panel's
 * shared footer (Save / Cancel buttons) can call into them without
 * caring which editor is actually mounted.
 */

export interface EditorHandle {
  /** Persist the current draft. Returns true on success, false on failure. */
  save: () => Promise<boolean>
  /** Discard local edits — re-sync the draft to the last saved server state. */
  cancel: () => void
}

export interface BaseEditorProps {
  workspaceId: string
  agentId: string
  /** Called after a successful save so the canvas can refetch the flow GET. */
  onSaved: () => void
  /** Whenever the editor's dirty state changes, notify the parent panel. */
  onDirtyChange: (dirty: boolean) => void
  /** Whenever the editor's saving state changes (used to disable the footer). */
  onSavingChange?: (saving: boolean) => void
}
