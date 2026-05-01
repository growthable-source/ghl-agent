'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'
import { MergeFieldInput, MergeFieldTextarea } from '@/components/MergeFieldHelper'
import { BUSINESS_CONTEXT_EXAMPLES } from '@/lib/business-context-examples'

type FallbackBehavior = 'message' | 'transfer' | 'message_and_transfer'

interface Settings {
  name: string
  systemPrompt: string
  instructions: string
  fallbackBehavior: FallbackBehavior
  fallbackMessage: string
  agentType: 'SIMPLE' | 'ADVANCED'
  businessContext: string
}

export default function AgentSettingsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<Settings | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      .then(r => r.json())
      .then(({ agent }) => {
        setInitial({
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          instructions: agent.instructions ?? '',
          fallbackBehavior: agent.fallbackBehavior ?? 'message',
          fallbackMessage: agent.fallbackMessage ?? '',
          agentType: (agent.agentType === 'ADVANCED' ? 'ADVANCED' : 'SIMPLE'),
          businessContext: agent.businessContext ?? '',
        })
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<Settings>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: d.name,
          systemPrompt: d.systemPrompt,
          instructions: d.instructions,
          fallbackBehavior: d.fallbackBehavior,
          fallbackMessage: d.fallbackMessage || null,
          agentType: d.agentType,
          // Send null when the textarea is blank so the DB column reflects
          // "no glossary" rather than an empty string.
          businessContext: d.businessContext.trim() || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  if (loading || !initial) return (
    <div className="flex items-center justify-center h-48">
      <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>Loading…</p>
    </div>
  )

  // Inputs/textareas all share the same theme-aware shell. Inline
  // styles so we never depend on the override block firing.
  const fieldStyle: React.CSSProperties = {
    background: 'var(--input-bg)',
    color: 'var(--input-text)',
    border: '1px solid var(--input-border)',
  }

  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  return (
    <div className="p-8 max-w-3xl pb-24">
      {/* Sectioned overview — quick deep-links into the four other
          surfaces of agent config. Mirrors the IA mockup's section
          cards on the Identity page so this isn't just a System Prompt
          form. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
        <SectionCard
          href={`${base}/knowledge`}
          title="Knowledge"
          desc="What the agent knows"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
            </svg>
          }
        />
        <SectionCard
          href={`${base}/tools`}
          title="Actions"
          desc="What it can do"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          }
        />
        <SectionCard
          href={`${base}/rules`}
          title="Rules"
          desc="When to hand off"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          }
        />
        <SectionCard
          href={`${base}/deploy`}
          title="Channels"
          desc="Where it talks"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          }
        />
      </div>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Agent Name</label>
          <input
            type="text"
            value={draft.name}
            onChange={e => set({ name: e.target.value })}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
            style={fieldStyle}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>System Prompt</label>
          <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Defines the agent&apos;s role, tone, and context. This is the base of every conversation.</p>
          <textarea
            value={draft.systemPrompt}
            onChange={e => set({ systemPrompt: e.target.value })}
            rows={10}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none resize-y font-mono"
            style={fieldStyle}
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
            Extra Instructions <span className="font-normal" style={{ color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Appended to every conversation. Useful for campaign-specific rules or temporary overrides.</p>
          <textarea
            value={draft.instructions}
            onChange={e => set({ instructions: e.target.value })}
            rows={3}
            className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none resize-y"
            style={fieldStyle}
          />
        </div>

        {/* Context Level ──
            SIMPLE matches the long-standing behaviour (name + tags in the
            prompt). ADVANCED additionally pre-loads the contact's recent
            opportunities and custom fields every turn, plus the operator's
            businessContext glossary. Upgrade/downgrade is instant — no
            migration — since every read of these fields is guarded by the
            agentType check in runAgent. */}
        <div className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Context Level</label>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>How much CRM context the agent sees on every turn. You can change this at any time.</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
            <button
              type="button"
              onClick={() => set({ agentType: 'SIMPLE' })}
              className="text-left rounded-lg border p-3 transition-colors"
              style={
                draft.agentType === 'SIMPLE'
                  ? { background: 'var(--accent-primary-bg)', borderColor: 'var(--accent-primary)' }
                  : { background: 'var(--surface)', borderColor: 'var(--border)' }
              }
            >
              <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Simple</p>
              <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                Name, tags, and conversation history. Zero extra token cost.
              </p>
            </button>
            <button
              type="button"
              onClick={() => set({ agentType: 'ADVANCED' })}
              className="text-left rounded-lg border p-3 transition-colors"
              style={
                draft.agentType === 'ADVANCED'
                  ? { background: 'var(--accent-emerald-bg)', borderColor: 'var(--accent-emerald)' }
                  : { background: 'var(--surface)', borderColor: 'var(--border)' }
              }
            >
              <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                Advanced
                <span
                  className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                  style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                >
                  context
                </span>
              </p>
              <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                Also loads opportunities (last ~6 months) + custom fields. Best for commercial agents.
              </p>
            </button>
          </div>

          {draft.agentType === 'ADVANCED' && (
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                Business Context <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
              </label>
              <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Plain-English explanation of what your custom fields and opportunities represent. The agent reads this alongside the live data so it knows how to interpret what it&apos;s seeing. Merge fields like <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{'{{contact.first_name|there}}'}</span> and <span className="font-mono" style={{ color: 'var(--text-tertiary)' }}>{'{{user.name|our team}}'}</span> resolve per-contact at runtime.
              </p>

              {/* Starter templates — same picker as the new-agent wizard.
                  Clicking a chip overwrites the textarea; operators can
                  mix and edit from there. Reset SaveBar handles undo. */}
              <div
                className="rounded-lg border p-3 mb-2"
                style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                  Start from an example
                </p>
                <div className="flex flex-wrap gap-2">
                  {BUSINESS_CONTEXT_EXAMPLES.map(ex => (
                    <button
                      key={ex.id}
                      type="button"
                      onClick={() => set({ businessContext: ex.body })}
                      className="text-xs border rounded-full px-3 py-1 transition-colors"
                      style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
                      title={ex.description}
                    >
                      {ex.label}
                    </button>
                  ))}
                  {draft.businessContext.trim() && (
                    <button
                      type="button"
                      onClick={() => set({ businessContext: '' })}
                      className="text-xs transition-colors px-2"
                      style={{ color: 'var(--text-tertiary)' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              </div>

              {/* MergeFieldTextarea adds the {{…}} Insert value picker
                  — same component used for trigger messages, follow-up
                  steps, and fallbacks. Tokens inserted here render
                  against the live contact + user at every turn. */}
              <MergeFieldTextarea
                value={draft.businessContext}
                onChange={e => set({ businessContext: e.target.value })}
                onValueChange={v => set({ businessContext: v })}
                placeholder="Write your own or pick an example above…"
                rows={10}
                className="w-full rounded-lg px-4 pt-10 pb-2.5 text-sm focus:outline-none resize-y"
                style={fieldStyle}
              />
            </div>
          )}
        </div>

        {/* Fallback behavior */}
        <div className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
          <label className="block text-sm font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>When the agent doesn&apos;t know the answer</label>
          <p className="text-xs mb-3" style={{ color: 'var(--text-tertiary)' }}>What should the agent do when a contact asks something it has no knowledge about?</p>
          <div className="space-y-2 mb-4">
            {([
              { value: 'message' as const, label: 'Send a fallback message', desc: 'Reply with a custom message and stay in the conversation' },
              { value: 'transfer' as const, label: 'Transfer to a human', desc: 'Immediately hand off to a human agent' },
              { value: 'message_and_transfer' as const, label: 'Message then transfer', desc: 'Send a message and then hand off to a human' },
            ] as const).map(opt => {
              const selected = draft.fallbackBehavior === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => set({ fallbackBehavior: opt.value })}
                  className="w-full flex items-start gap-3 rounded-lg border p-3 text-left transition-colors"
                  style={
                    selected
                      ? { background: 'var(--accent-primary-bg)', borderColor: 'var(--accent-primary)' }
                      : { background: 'var(--surface)', borderColor: 'var(--border)' }
                  }
                >
                  <span
                    className="mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                    style={{ borderColor: selected ? 'var(--accent-primary)' : 'var(--border-secondary)' }}
                  >
                    {selected && <span className="w-2 h-2 rounded-full" style={{ background: 'var(--accent-primary)' }} />}
                  </span>
                  <div>
                    <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {(draft.fallbackBehavior === 'message' || draft.fallbackBehavior === 'message_and_transfer') && (
            <div>
              <label className="block text-xs mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Fallback message</label>
              <MergeFieldInput
                value={draft.fallbackMessage}
                onChange={e => set({ fallbackMessage: e.target.value })}
                onValueChange={v => set({ fallbackMessage: v })}
                placeholder="{{contact.first_name|There}}, great question — let me find out and get back to you."
                className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                style={fieldStyle}
              />
            </div>
          )}
        </div>
      </div>

      <SaveBar dirty={dirty} saving={saving} savedAt={savedAt} error={error} onSave={save} onReset={reset} />
    </div>
  )
}

function SectionCard({
  href,
  title,
  desc,
  icon,
}: {
  href: string
  title: string
  desc: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className="rounded-xl border p-3 transition-colors group"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
        >
          {icon}
        </span>
        <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      </div>
      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      <p
        className="text-[11px] mt-1 font-medium opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--accent-primary)' }}
      >
        Configure →
      </p>
    </Link>
  )
}
