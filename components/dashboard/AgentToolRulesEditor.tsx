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
  const [currentPresetId, setCurrentPresetId] = useState<string | null>(null)
  const [applyDialogOpen, setApplyDialogOpen] = useState(false)
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [cfgRes, presetsRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, { cache: 'no-store' }),
        fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config/presets`, { cache: 'no-store' }),
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

  if (loading) return <div style={{ opacity: 0.6 }}>Loading tool config…</div>

  const toolsByName = new Map(tools.map(t => [t.toolName, t]))
  const currentPreset = currentPresetId ? presets.find(p => p.id === currentPresetId) ?? null : null

  return (
    <div>
      {/* Autonomy mode toggle */}
      <div style={{ padding: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Mode</h3>
            {currentPreset && (
              <span
                style={{
                  fontSize: 11,
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: 'var(--bg-subtle, #f3f4f6)',
                  border: '1px solid var(--border, #e5e7eb)',
                  color: 'var(--fg-muted, #4b5563)',
                }}
              >
                Currently configured as: <strong>{currentPreset.label}</strong>
              </span>
            )}
          </div>
          {presets.length > 0 && (
            <button
              type="button"
              onClick={openApplyDialog}
              style={{
                padding: '6px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: '1px solid var(--border, #e5e7eb)',
                background: 'var(--bg, #fff)',
                color: 'var(--fg, #111827)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Apply preset
            </button>
          )}
        </div>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <input type="radio" name="autonomyMode" value="guided"
            checked={autonomyMode === 'guided'} onChange={() => setAutonomyMode('guided')} />
          <div>
            <strong>Guided</strong> (recommended) — each tool follows its &ldquo;use when&rdquo; rule.
          </div>
        </label>
        <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 8 }}>
          <input type="radio" name="autonomyMode" value="autonomous"
            checked={autonomyMode === 'autonomous'} onChange={() => setAutonomyMode('autonomous')} />
          <div>
            <strong>Autonomous</strong> — the agent decides which tools to call freely. Per-tool rules below are bypassed.
          </div>
        </label>
      </div>

      {/* Per-category tool sections */}
      {TOOL_CATEGORIES.map(cat => {
        const catTools = cat.toolNames
          .map(n => toolsByName.get(n))
          .filter((t): t is ResolvedToolConfig => !!t)
        if (catTools.length === 0) return null

        const isOpen = openCats[cat.id] ?? true
        return (
          <div key={cat.id} style={{ marginBottom: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setOpenCats(s => ({ ...s, [cat.id]: !isOpen }))}
              style={{
                width: '100%', padding: 12, textAlign: 'left',
                background: 'var(--bg-subtle, #f9fafb)', border: 'none', borderRadius: 8,
                fontWeight: 600, fontSize: 14, cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <span>{cat.label} <span style={{ opacity: 0.6, fontWeight: 400, fontSize: 12 }}>({catTools.length})</span></span>
              <span>{isOpen ? '▾' : '▸'}</span>
            </button>
            {isOpen && (
              <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {catTools.map(t => (
                  <div key={t.toolName} style={{ padding: 12, background: 'var(--bg, #fff)', border: '1px solid var(--border, #e5e7eb)', borderRadius: 6, opacity: autonomyMode === 'autonomous' ? 0.55 : 1 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontFamily: 'monospace', fontSize: 13 }}>
                        <input type="checkbox" checked={t.enabled}
                          onChange={e => setTool(t.toolName, { enabled: e.target.checked })} />
                        {t.toolName}
                      </label>
                      <button type="button" onClick={() => resetTool(t.toolName)}
                        style={{ fontSize: 11, padding: '2px 8px', border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, background: 'transparent', cursor: 'pointer' }}>
                        Reset to default
                      </button>
                    </div>
                    <label style={{ fontSize: 12, opacity: 0.8 }}>Use this tool when:</label>
                    <textarea
                      value={t.useWhen}
                      onChange={e => setTool(t.toolName, { useWhen: e.target.value })}
                      placeholder="(catalog default applies)"
                      rows={2}
                      style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4, resize: 'vertical' }}
                    />
                    <label style={{ fontSize: 12, opacity: 0.8, marginTop: 8, display: 'block' }}>On failure:</label>
                    <select value={t.onFailure}
                      onChange={e => setTool(t.toolName, { onFailure: e.target.value as OnFailureMode, onFailureMessage: e.target.value === 'canned_message' ? (t.onFailureMessage ?? '') : null })}
                      style={{ padding: 6, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4 }}>
                      {(['default', 'transfer_to_human', 'canned_message', 'silent_skip'] as OnFailureMode[]).map(m => (
                        <option key={m} value={m}>{ON_FAILURE_LABELS[m]}</option>
                      ))}
                    </select>
                    {t.onFailure === 'canned_message' && (
                      <>
                        <label style={{ fontSize: 12, opacity: 0.8, marginTop: 8, display: 'block' }}>Canned message:</label>
                        <textarea
                          value={t.onFailureMessage ?? ''}
                          onChange={e => setTool(t.toolName, { onFailureMessage: e.target.value })}
                          rows={2}
                          placeholder="Message sent to the contact when this tool fails."
                          style={{ width: '100%', padding: 8, fontSize: 13, border: '1px solid var(--border, #e5e7eb)', borderRadius: 4, marginTop: 4, resize: 'vertical' }}
                        />
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* Save bar */}
      <div style={{ position: 'sticky', bottom: 0, padding: 12, background: 'var(--bg, #fff)', borderTop: '1px solid var(--border, #e5e7eb)', display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12 }}>
        {savedAt && <span style={{ color: 'var(--accent-emerald, #047857)', fontSize: 12 }}>Saved</span>}
        <button type="button" onClick={saveAll} disabled={saving}
          style={{ padding: '8px 16px', background: 'var(--button-bg, #111827)', color: '#fff', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: saving ? 'wait' : 'pointer' }}>
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
    </div>
  )
}
