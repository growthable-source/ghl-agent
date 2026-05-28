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

  async function load() {
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/tool-config`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setAutonomyMode(data.autonomyMode ?? 'guided')
      setTools(data.tools ?? [])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [workspaceId, agentId])

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

  return (
    <div>
      {/* Autonomy mode toggle */}
      <div style={{ padding: 16, border: '1px solid var(--border, #e5e7eb)', borderRadius: 8, marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Mode</h3>
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
    </div>
  )
}
