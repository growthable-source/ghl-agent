'use client'

/**
 * Per-tool config editor for the /tools page. Drives the agent's
 * AgentToolConfig rows + Agent.toolAutonomyMode via the
 * /tool-config endpoint.
 *
 * Loads on mount via GET, keeps an in-memory edit buffer, and POSTs the
 * full tool list back on Save. Per-tool "Reset to default" hits DELETE
 * which clears the agent's override row for that tool — the runtime then
 * falls back to catalog defaults transparently.
 *
 * Autonomy radio at the top toggles between Guided (rules apply) and
 * Autonomous (rules bypassed). In Autonomous mode the per-tool rows visually
 * grey out but stay editable — the rules are still saved, just not enforced.
 */

import { useEffect, useState } from 'react'
import { TOOL_CATEGORIES } from '@/lib/agent/tool-categories'

type OnFailureMode = 'default' | 'transfer_to_human' | 'canned_message' | 'silent_skip'

interface ResolvedToolConfig {
  toolName: string
  enabled: boolean
  useWhen: string
  onFailure: OnFailureMode
  onFailureMessage: string | null
}

const ON_FAILURE_LABELS: Record<OnFailureMode, string> = {
  default: 'Default — graceful AI fallback + pause + email',
  transfer_to_human: 'Transfer to human (skip AI fallback)',
  canned_message: 'Send canned message + pause',
  silent_skip: 'Silent skip (pretend success, continue)',
}

interface PresetSummary {
  id: string
  label: string
  description: string
  autonomyMode: 'guided' | 'autonomous'
}

/** Workspace-defined preset row as returned by /custom-presets GET. */
interface WorkspacePresetSummary {
  id: string
  name: string
  description: string | null
  autonomyMode: 'guided' | 'autonomous'
  createdAt: string
}

export function AgentToolRulesEditor({
  workspaceId,
  agentId,
}: {
  workspaceId: string
  agentId: string
}) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [autonomyMode, setAutonomyMode] = useState<'guided' | 'autonomous'>('guided')
  const [tools, setTools] = useState<ResolvedToolConfig[]>([])
  const [openCats, setOpenCats] = useState<Record<string, boolean>>({})
  const [presets, setPresets] = useState<PresetSummary[]>([])
  const [customPresets, setCustomPresets] = useState<WorkspacePresetSummary[]>([])
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  // Save-as-preset modal state.
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveDescription, setSaveDescription] = useState('')
  const [saveIncludeAutonomy, setSaveIncludeAutonomy] = useState(true)
  const [saveIncludeTools, setSaveIncludeTools] = useState(true)
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetSavedName, setPresetSavedName] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function loadCustomPresets() {
    const res = await fetch(`/api/workspaces/${workspaceId}/custom-presets`, { cache: 'no-store' })
    if (res.ok) {
      const data = await res.json()
      setCustomPresets(data.presets ?? [])
    }
  }

  async function load() {
    setLoading(true)
    try {
      const [cfgRes, presetsRes, customRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, { cache: 'no-store' }),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/presets`, { cache: 'no-store' }),
        fetch(`/api/workspaces/${workspaceId}/custom-presets`, { cache: 'no-store' }),
      ])
      if (cfgRes.ok) {
        const data = await cfgRes.json()
        setAutonomyMode(data.autonomyMode ?? 'guided')
        setTools(data.tools ?? [])
      }
      if (presetsRes.ok) {
        const pdata = await presetsRes.json()
        setPresets(pdata.presets ?? [])
        setCurrentPresetId(pdata.current ?? null)
      }
      if (customRes.ok) {
        const cdata = await customRes.json()
        setCustomPresets(cdata.presets ?? [])
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [workspaceId, agentId])

  function openApplyDialog() {
    setSelectedPresetId(currentPresetId ?? presets[0]?.id ?? null)
    setApplyDialogOpen(true)
  }

  async function applySelectedPreset() {
    if (!selectedPresetId) return
    setApplying(true)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/apply-preset`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ presetId: selectedPresetId }),
        },
      )
      if (res.ok) {
        const data = await res.json()
        setAutonomyMode(data.autonomyMode ?? 'guided')
        setTools(data.tools ?? [])
        setCurrentPresetId(data.presetId ?? null)
        setApplyDialogOpen(false)
      }
    } finally {
      setApplying(false)
    }
  }

  function openSaveDialog() {
    setSaveName('')
    setSaveDescription('')
    setSaveIncludeAutonomy(true)
    setSaveIncludeTools(true)
    setSaveError(null)
    setSaveDialogOpen(true)
  }

  /**
   * Build the deltas to ship to POST /custom-presets. We only include
   * rows that diverge from catalog defaults: disabled, custom useWhen,
   * non-default onFailure, or a canned message set. Catalog-default
   * rows are omitted so the saved preset doesn't bloat with no-op entries.
   */
  function buildToolDeltas() {
    return tools
      .filter(t =>
        t.enabled === false
        || (t.useWhen != null && t.useWhen !== '')
        || t.onFailure !== 'default'
        || t.onFailureMessage != null,
      )
      .map(t => ({
        toolName: t.toolName,
        enabled: t.enabled,
        useWhen: t.useWhen || undefined,
        onFailure: t.onFailure,
        onFailureMessage: t.onFailureMessage ?? undefined,
      }))
  }

  async function saveAsPreset() {
    const name = saveName.trim()
    if (name.length === 0) {
      setSaveError('Name is required.')
      return
    }
    setSavingPreset(true)
    setSaveError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/custom-presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          description: saveDescription.trim() || undefined,
          autonomyMode: saveIncludeAutonomy ? autonomyMode : 'guided',
          tools: saveIncludeTools ? buildToolDeltas() : [],
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSaveError(typeof data?.error === 'string' ? data.error : 'Save failed.')
        return
      }
      setPresetSavedName(name)
      setSaveDialogOpen(false)
      setTimeout(() => setPresetSavedName(null), 3000)
      void loadCustomPresets()
    } finally {
      setSavingPreset(false)
    }
  }

  async function deleteCustomPreset(presetId: string, name: string) {
    if (!window.confirm(`Delete the preset "${name}"? This cannot be undone.`)) return
    const res = await fetch(`/api/workspaces/${workspaceId}/custom-presets/${presetId}`, {
      method: 'DELETE',
    })
    if (res.ok) {
      setCustomPresets(prev => prev.filter(p => p.id !== presetId))
      if (selectedPresetId === presetId) {
        setSelectedPresetId(presets[0]?.id ?? null)
      }
      if (currentPresetId === presetId) {
        setCurrentPresetId(null)
      }
    }
  }

  function setTool(toolName: string, patch: Partial<ResolvedToolConfig>) {
    setTools(prev => prev.map(t => t.toolName === toolName ? { ...t, ...patch } : t))
  }

  async function saveAll() {
    setSaving(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          autonomyMode,
          tools: tools.map(t => ({
            toolName: t.toolName,
            enabled: t.enabled,
            useWhen: t.useWhen,
            onFailure: t.onFailure,
            onFailureMessage: t.onFailureMessage,
          })),
        }),
      })
      if (res.ok) {
        setSavedAt(Date.now())
        setTimeout(() => setSavedAt(null), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  async function resetTool(toolName: string) {
    const res = await fetch(
      `/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/${toolName}`,
      { method: 'DELETE' },
    )
    if (res.ok) await load()
  }

  if (loading) {
    return <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading tool config…</p>
  }

  const toolsByName = new Map(tools.map(t => [t.toolName, t]))
  const currentPresetHardcoded = currentPresetId ? presets.find(p => p.id === currentPresetId) ?? null : null
  const currentPresetCustom = currentPresetId ? customPresets.find(p => p.id === currentPresetId) ?? null : null
  const currentPresetLabel = currentPresetHardcoded?.label ?? currentPresetCustom?.name ?? null

  // Visual conventions match the surrounding /tools page (Tailwind + CSS
  // vars): rounded-xl border for cards, text-sm body / text-xs hints,
  // space-y-* for vertical rhythm. Previous inline-style pixel sizes
  // (fontSize 16 headings, 13px tool names, 8px radius) made this
  // editor stand out against the page's `p-8 max-w-2xl` chrome —
  // bigger/blockier than the other sections. Now consistent.
  return (
    <div className="space-y-4">
      {/* Mode + preset actions */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Mode</p>
            {currentPresetLabel && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full border"
                style={{
                  background: 'var(--surface-secondary)',
                  borderColor: 'var(--border)',
                  color: 'var(--text-secondary)',
                }}
              >
                Currently configured as: <strong>{currentPresetLabel}</strong>
              </span>
            )}
            {presetSavedName && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-full border"
                style={{
                  background: 'var(--accent-emerald-bg)',
                  borderColor: 'var(--accent-emerald)',
                  color: 'var(--accent-emerald)',
                }}
              >
                Saved as &ldquo;{presetSavedName}&rdquo;
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={openSaveDialog}
              className="text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors"
              style={{
                borderColor: 'var(--border)',
                background: 'var(--surface)',
                color: 'var(--text-primary)',
              }}
            >
              Save as preset
            </button>
            {presets.length > 0 && (
              <button
                type="button"
                onClick={openApplyDialog}
                className="text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors"
                style={{
                  borderColor: 'var(--border)',
                  background: 'var(--surface)',
                  color: 'var(--text-primary)',
                }}
              >
                Apply preset
              </button>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
            <input
              type="radio"
              name="autonomyMode"
              value="guided"
              checked={autonomyMode === 'guided'}
              onChange={() => setAutonomyMode('guided')}
              className="mt-0.5"
            />
            <span>
              <strong>Guided</strong>{' '}
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>(recommended)</span>{' '}
              — each tool follows its &ldquo;use when&rdquo; rule.
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-primary)' }}>
            <input
              type="radio"
              name="autonomyMode"
              value="autonomous"
              checked={autonomyMode === 'autonomous'}
              onChange={() => setAutonomyMode('autonomous')}
              className="mt-0.5"
            />
            <span>
              <strong>Autonomous</strong> — the agent decides which tools to call freely. Per-tool rules below are bypassed.
            </span>
          </label>
        </div>
      </div>

      {/* Per-category tool sections */}
      {TOOL_CATEGORIES.map(cat => {
        const catTools = cat.toolNames
          .map(n => toolsByName.get(n))
          .filter((t): t is ResolvedToolConfig => !!t)
        if (catTools.length === 0) return null

        const isOpen = openCats[cat.id] ?? true
        return (
          <div
            key={cat.id}
            className="rounded-xl border overflow-hidden"
            style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
          >
            <button
              type="button"
              onClick={() => setOpenCats(s => ({ ...s, [cat.id]: !isOpen }))}
              className="w-full px-4 py-3 flex items-center justify-between text-left transition-colors"
              style={{ background: 'var(--surface-secondary)' }}
            >
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {cat.label}{' '}
                <span className="text-xs font-normal" style={{ color: 'var(--text-tertiary)' }}>
                  ({catTools.length})
                </span>
              </span>
              <span className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                {isOpen ? '▾' : '▸'}
              </span>
            </button>

            {isOpen && (
              <div
                className="p-3 space-y-3"
                style={{
                  borderTop: '1px solid var(--border)',
                  opacity: autonomyMode === 'autonomous' ? 0.55 : 1,
                }}
              >
                {catTools.map(t => (
                  <div
                    key={t.toolName}
                    className="rounded-lg border p-3 space-y-2"
                    style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={t.enabled}
                          onChange={e => setTool(t.toolName, { enabled: e.target.checked })}
                        />
                        <code className="text-xs font-mono" style={{ color: 'var(--text-primary)' }}>
                          {t.toolName}
                        </code>
                      </label>
                      <button
                        type="button"
                        onClick={() => resetTool(t.toolName)}
                        className="text-[11px] px-2 py-0.5 rounded border transition-colors"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'transparent',
                          color: 'var(--text-secondary)',
                        }}
                      >
                        Reset to default
                      </button>
                    </div>

                    <div>
                      <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        Use this tool when:
                      </label>
                      <textarea
                        value={t.useWhen}
                        onChange={e => setTool(t.toolName, { useWhen: e.target.value })}
                        placeholder="(catalog default applies)"
                        rows={2}
                        className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--text-primary)',
                        }}
                      />
                    </div>

                    <div>
                      <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                        On failure:
                      </label>
                      <select
                        value={t.onFailure}
                        onChange={e => setTool(t.toolName, {
                          onFailure: e.target.value as OnFailureMode,
                          onFailureMessage: e.target.value === 'canned_message' ? (t.onFailureMessage ?? '') : null,
                        })}
                        className="w-full text-sm px-2.5 py-1.5 rounded border"
                        style={{
                          borderColor: 'var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {(['default', 'transfer_to_human', 'canned_message', 'silent_skip'] as OnFailureMode[]).map(m => (
                          <option key={m} value={m}>{ON_FAILURE_LABELS[m]}</option>
                        ))}
                      </select>
                    </div>

                    {t.onFailure === 'canned_message' && (
                      <div>
                        <label className="text-xs block mb-1" style={{ color: 'var(--text-secondary)' }}>
                          Canned message:
                        </label>
                        <textarea
                          value={t.onFailureMessage ?? ''}
                          onChange={e => setTool(t.toolName, { onFailureMessage: e.target.value })}
                          rows={2}
                          placeholder="Message sent to the contact when this tool fails."
                          className="w-full text-sm px-2.5 py-1.5 rounded border resize-y"
                          style={{
                            borderColor: 'var(--border)',
                            background: 'var(--surface)',
                            color: 'var(--text-primary)',
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Sticky save bar */}
      <div
        className="sticky bottom-0 -mx-4 px-4 py-3 flex items-center justify-end gap-3 border-t"
        style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        {savedAt && (
          <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>Saved</span>
        )}
        <button
          type="button"
          onClick={saveAll}
          disabled={saving}
          className="text-sm font-semibold px-4 py-1.5 rounded-md transition-colors"
          style={{
            background: 'var(--button-bg, var(--text-primary))',
            color: 'var(--button-text, var(--surface))',
            cursor: saving ? 'wait' : 'pointer',
          }}
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>

      {/* Apply preset modal */}
      {applyDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="apply-preset-title"
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
          onClick={() => { if (!applying) setApplyDialogOpen(false) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 8,
              padding: 20,
              width: '100%',
              maxWidth: 560,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 id="apply-preset-title" style={{ fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 12 }}>Apply preset</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {presets.map(p => {
                const isSelected = selectedPresetId === p.id
                return (
                  <label
                    key={p.id}
                    style={{
                      display: 'flex',
                      gap: 10,
                      alignItems: 'flex-start',
                      padding: 12,
                      border: `1px solid ${isSelected ? 'var(--accent, #2563eb)' : 'var(--border, #e5e7eb)'}`,
                      borderRadius: 6,
                      cursor: 'pointer',
                      background: isSelected ? 'var(--bg-subtle, #f3f4f6)' : 'var(--bg, #fff)',
                    }}
                  >
                    <input
                      type="radio"
                      name="applyPresetChoice"
                      value={p.id}
                      checked={isSelected}
                      onChange={() => setSelectedPresetId(p.id)}
                      style={{ marginTop: 3 }}
                    />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {p.label}
                        {currentPresetId === p.id && (
                          <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, opacity: 0.7 }}>(current)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{p.description}</div>
                    </div>
                  </label>
                )
              })}
            </div>
            {customPresets.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <h4 style={{ fontSize: 13, fontWeight: 600, margin: 0, marginBottom: 8, color: 'var(--fg-muted, #4b5563)' }}>
                  Custom presets
                </h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {customPresets.map(p => {
                    const isSelected = selectedPresetId === p.id
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          padding: 12,
                          border: `1px solid ${isSelected ? 'var(--accent, #2563eb)' : 'var(--border, #e5e7eb)'}`,
                          borderRadius: 6,
                          background: isSelected ? 'var(--bg-subtle, #f3f4f6)' : 'var(--bg, #fff)',
                        }}
                      >
                        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', flex: 1, cursor: 'pointer' }}>
                          <input
                            type="radio"
                            name="applyPresetChoice"
                            value={p.id}
                            checked={isSelected}
                            onChange={() => setSelectedPresetId(p.id)}
                            style={{ marginTop: 3 }}
                          />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600, fontSize: 14 }}>
                              {p.name}
                              {currentPresetId === p.id && (
                                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, opacity: 0.7 }}>(current)</span>
                              )}
                            </div>
                            {p.description && (
                              <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>{p.description}</div>
                            )}
                          </div>
                        </label>
                        <button
                          type="button"
                          onClick={() => deleteCustomPreset(p.id, p.name)}
                          aria-label={`Delete preset ${p.name}`}
                          title="Delete preset"
                          style={{
                            background: 'transparent',
                            border: '1px solid var(--border, #e5e7eb)',
                            borderRadius: 4,
                            padding: '2px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                            color: 'var(--accent-danger, #b91c1c)',
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <p style={{ fontSize: 12, color: 'var(--accent-amber, #b45309)', marginTop: 16, marginBottom: 0 }}>
              Applying a preset overwrites the matching tool&rsquo;s config. Tools not listed in the preset are left untouched.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                onClick={() => setApplyDialogOpen(false)}
                disabled={applying}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--bg, #fff)',
                  color: 'var(--fg, #111827)',
                  borderRadius: 6,
                  cursor: applying ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applySelectedPreset}
                disabled={applying || !selectedPresetId}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'var(--button-bg, #111827)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: applying ? 'wait' : (!selectedPresetId ? 'not-allowed' : 'pointer'),
                  opacity: !selectedPresetId ? 0.6 : 1,
                }}
              >
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Save-as-preset modal */}
      {saveDialogOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-preset-title"
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
          onClick={() => { if (!savingPreset) setSaveDialogOpen(false) }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: 'var(--bg, #fff)',
              border: '1px solid var(--border, #e5e7eb)',
              borderRadius: 8,
              padding: 20,
              width: '100%',
              maxWidth: 480,
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <h3 id="save-preset-title" style={{ fontSize: 16, fontWeight: 600, margin: 0, marginBottom: 4 }}>Save current config as preset</h3>
            <p style={{ fontSize: 12, opacity: 0.7, margin: 0, marginBottom: 16 }}>
              Reuse this configuration on other agents in this workspace.
            </p>

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Name
            </label>
            <input
              type="text"
              value={saveName}
              onChange={e => setSaveName(e.target.value)}
              maxLength={80}
              placeholder="e.g. Booking + opportunity writes"
              style={{
                width: '100%', padding: 8, fontSize: 13,
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 4,
                marginBottom: 12,
              }}
            />

            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              Description (optional)
            </label>
            <textarea
              value={saveDescription}
              onChange={e => setSaveDescription(e.target.value)}
              rows={3}
              maxLength={280}
              placeholder="What this preset is for, when to use it."
              style={{
                width: '100%', padding: 8, fontSize: 13,
                border: '1px solid var(--border, #e5e7eb)', borderRadius: 4,
                resize: 'vertical', marginBottom: 16,
              }}
            />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={saveIncludeAutonomy}
                  onChange={e => setSaveIncludeAutonomy(e.target.checked)}
                />
                Include autonomy mode in this preset ({autonomyMode})
              </label>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={saveIncludeTools}
                  onChange={e => setSaveIncludeTools(e.target.checked)}
                />
                Include all tool customizations ({buildToolDeltas().length})
              </label>
            </div>

            {saveError && (
              <div style={{
                fontSize: 12, color: 'var(--accent-danger, #b91c1c)',
                marginBottom: 12,
              }}>
                {saveError}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                onClick={() => setSaveDialogOpen(false)}
                disabled={savingPreset}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  border: '1px solid var(--border, #e5e7eb)',
                  background: 'var(--bg, #fff)',
                  color: 'var(--fg, #111827)',
                  borderRadius: 6,
                  cursor: savingPreset ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveAsPreset}
                disabled={savingPreset || saveName.trim().length === 0}
                style={{
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: 'var(--button-bg, #111827)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: savingPreset ? 'wait' : (saveName.trim().length === 0 ? 'not-allowed' : 'pointer'),
                  opacity: saveName.trim().length === 0 ? 0.6 : 1,
                }}
              >
                {savingPreset ? 'Saving…' : 'Save preset'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
