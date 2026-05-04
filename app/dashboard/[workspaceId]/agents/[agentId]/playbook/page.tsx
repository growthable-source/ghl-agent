'use client'

/**
 * Playbook — operator-authored "when X, do Y" rules.
 *
 * The model never invokes these directly. The deterministic rule
 * engine evaluates triggers AFTER the model writes its reply, then
 * fires the configured action. So every CRM mutation is something
 * an operator deliberately wired up.
 *
 * Stored as AgentRule rows under the hood. This page is a thin shell
 * that lists them as Plays — the editor at /playbook/new and
 * /playbook/[id] is the action-first form.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { getPlayAction, type PlayActionType } from '@/lib/agent-tools-catalog'

interface AgentRule {
  id: string
  name: string
  conditionDescription: string
  examples: string[]
  actionType: PlayActionType
  actionParams: Record<string, any> | null
  targetFieldKey: string
  targetValue: string
  overwrite: boolean
  isActive: boolean
  order: number
}

function describeAction(rule: AgentRule): string {
  const def = getPlayAction(rule.actionType)
  if (!def) return rule.actionType
  // Prefer a concrete description if we can infer one from the params,
  // so the card reads "Mark Won" instead of "Change opportunity status".
  switch (rule.actionType) {
    case 'opportunity_status': {
      const status = rule.actionParams?.status
      if (status) return `Mark opportunity as ${String(status).toLowerCase()}`
      return def.label
    }
    case 'opportunity_value': {
      const val = rule.actionParams?.value
      if (val) return `Set deal value to ${val}`
      return def.label
    }
    case 'update_contact_field': {
      const key = rule.targetFieldKey || rule.actionParams?.fieldKey
      const val = rule.targetValue || rule.actionParams?.value
      if (key && val) return `Set ${key} = "${val}"`
      if (key) return `Update field "${key}"`
      return def.label
    }
    case 'update_contact_tags': {
      const tags = rule.actionParams?.tags
      if (Array.isArray(tags) && tags.length > 0) {
        return `Add tag${tags.length > 1 ? 's' : ''}: ${tags.slice(0, 3).map((t: string) => `"${t}"`).join(', ')}${tags.length > 3 ? '…' : ''}`
      }
      return def.label
    }
    case 'remove_contact_tags': {
      const tags = rule.actionParams?.tags
      if (Array.isArray(tags) && tags.length > 0) {
        return `Remove tag${tags.length > 1 ? 's' : ''}: ${tags.slice(0, 3).map((t: string) => `"${t}"`).join(', ')}${tags.length > 3 ? '…' : ''}`
      }
      return def.label
    }
    case 'add_to_workflow': {
      const ids = rule.actionParams?.workflowIds
      if (Array.isArray(ids) && ids.length > 0) {
        return `Enrol in ${ids.length} workflow${ids.length > 1 ? 's' : ''}`
      }
      return def.label
    }
    case 'remove_from_workflow': {
      const ids = rule.actionParams?.workflowIds
      if (Array.isArray(ids) && ids.length > 0) {
        return `Remove from ${ids.length} workflow${ids.length > 1 ? 's' : ''}`
      }
      return def.label
    }
    case 'dnd_channel': {
      const ch = rule.actionParams?.channel
      return ch ? `Mark Do Not Disturb on ${ch}` : 'Mark as Do Not Disturb'
    }
    default:
      return def.label
  }
}

export default function PlaybookPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [rules, setRules] = useState<AgentRule[] | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules`)
      .then(r => r.json())
      .then(d => setRules(d.rules ?? []))
      .catch(() => setRules([]))
  }, [workspaceId, agentId])

  async function toggleActive(rule: AgentRule) {
    const updated = !rule.isActive
    setRules(rules!.map(r => r.id === rule.id ? { ...r, isActive: updated } : r))
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: updated }),
    })
  }

  async function deleteRule(id: string) {
    if (!confirm('Delete this Play? This cannot be undone.')) return
    setRules(rules!.filter(r => r.id !== id))
    await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules/${id}`, { method: 'DELETE' })
  }

  if (rules === null) {
    return (
      <div className="p-8 max-w-2xl space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="h-32 rounded-xl animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
        ))}
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl space-y-4">
      {/* Top banner explains the model */}
      <div
        className="rounded-xl border p-4"
        style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
      >
        <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
          Playbook
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          Specific actions the agent takes when specific things happen in
          conversation. Each Play is one trigger and one action — fired
          deterministically after the agent replies, never on the model's
          discretion.
        </p>
      </div>

      {/* Add button — top of list so the "what now?" answer is obvious */}
      <Link
        href={`${base}/playbook/new`}
        className="block rounded-xl border-2 border-dashed p-4 text-center transition-colors hover:opacity-80"
        style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
      >
        <span className="text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>+ Add a Play</span>
      </Link>

      {/* Plays list */}
      {rules.length === 0 ? (
        <div
          className="rounded-xl border p-8 text-center"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
            No Plays yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            Plays are how you tell the agent to mutate CRM data — pipeline
            stages, deal values, tags, workflow enrolments. Add your first
            one above.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rules.map(rule => (
            <li
              key={rule.id}
              className="rounded-xl border overflow-hidden"
              style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
            >
              <div
                className="flex items-center justify-between px-4 py-2.5 border-b"
                style={{ borderColor: 'var(--border-secondary)', background: 'var(--surface-secondary)' }}
              >
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  {rule.name || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>(unnamed)</span>}
                </p>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`${base}/playbook/${rule.id}`}
                    className="text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ color: 'var(--accent-primary)' }}
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => deleteRule(rule.id)}
                    className="text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Delete
                  </button>
                  <button
                    onClick={() => toggleActive(rule)}
                    className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                    style={{ background: rule.isActive ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
                    role="switch"
                    aria-checked={rule.isActive}
                    title={rule.isActive ? 'On — click to disable' : 'Off — click to enable'}
                  >
                    <span
                      className="inline-block h-4 w-4 transform rounded-full shadow transition-transform"
                      style={{
                        background: 'var(--btn-primary-text)',
                        transform: rule.isActive ? 'translateX(16px)' : 'translateX(0)',
                      }}
                    />
                  </button>
                </div>
              </div>
              <div className="px-4 py-3 space-y-2">
                {/* WHEN clause */}
                <div>
                  <p
                    className="text-[10px] uppercase tracking-wider font-semibold mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    When
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {rule.conditionDescription || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>(no condition described)</span>}
                  </p>
                  {rule.examples && rule.examples.length > 0 && (
                    <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-tertiary)' }}>
                      Example phrases: {rule.examples.slice(0, 3).map((e, i) => (
                        <span key={i}>
                          <span style={{ color: 'var(--text-secondary)' }}>"{e}"</span>
                          {i < Math.min(rule.examples.length, 3) - 1 && ', '}
                        </span>
                      ))}
                      {rule.examples.length > 3 && ` +${rule.examples.length - 3} more`}
                    </p>
                  )}
                </div>
                {/* THEN clause */}
                <div>
                  <p
                    className="text-[10px] uppercase tracking-wider font-semibold mb-1"
                    style={{ color: 'var(--text-tertiary)' }}
                  >
                    Then
                  </p>
                  <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {describeAction(rule)}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
