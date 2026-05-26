'use client'

/**
 * "When this agent runs" — unified editor.
 *
 * One page that answers the only question a user has when configuring an
 * agent: when does it actually fire? Previously this was split across:
 *
 *   /deploy   — channel toggles (per-agent ChannelDeployment)
 *   /routing  — RoutingRule editor (inbound message conditions)
 *   /triggers — AgentTrigger editor (proactive CRM events)
 *
 * Three confusing entry points with overlapping language. This page merges
 * them into one editor with three sections, top to bottom:
 *
 *   1. Channels        (inline toggles — replaces /deploy)
 *   2. Inbound filters (summary + link to advanced compound builder at
 *                       /routing — too complex to embed inline)
 *   3. CRM events      (inline editor for AgentTrigger — replaces
 *                       /triggers, which now redirects here)
 *
 * Status banner at the top reflects the agent's actual listening state so
 * users immediately know whether their config will fire on the next
 * inbound. Working hours stay on their own page (different concept — when
 * the agent is *allowed* to act, not what triggers it).
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon,
} from '@/components/icons/brand-icons'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import TagCombobox from '@/components/TagCombobox'
import ChannelFilterBuilder from '@/components/dashboard/ChannelFilterBuilder'
import { useDirtyForm } from '@/lib/use-dirty-form'
import SaveBar from '@/components/dashboard/SaveBar'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ChannelDeployment {
  id?: string
  channel: string
  isActive: boolean
  config?: any
}

interface RoutingRule {
  id: string
  ruleType: string
  value: string | null
  // Per-channel scope. Empty array = legacy global rule (applies on
  // every channel the agent listens on). Non-empty = scoped to listed
  // channels. The inline per-channel builder always writes a single-
  // channel array; multi-channel and global rules are managed via the
  // standalone /routing page.
  channels?: string[]
  conditions: { groups?: { clauses: { ruleType: string; values: string[]; negate?: boolean }[] }[]; clauses?: any[] } | null
}

interface AgentTrigger {
  id: string
  eventType: 'ContactCreate' | 'ContactTagUpdate'
  tagFilter: string | null
  channel: string
  messageMode: 'FIXED' | 'AI_GENERATE'
  fixedMessage: string | null
  aiInstructions: string | null
  delaySeconds: number
  isActive: boolean
}

interface AgentDetails {
  isActive: boolean
  routingRules: RoutingRule[]
  locationId: string
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CHANNELS = [
  { key: 'SMS', label: 'SMS', desc: 'Text messages via LeadConnector', icon: <SmsIcon className="w-5 h-5" />, color: 'text-blue-400' },
  { key: 'WhatsApp', label: 'WhatsApp', desc: 'WhatsApp Business via LeadConnector', icon: <WhatsAppIcon className="w-5 h-5" />, color: 'text-[#25D366]' },
  { key: 'FB', label: 'Facebook Messenger', desc: 'Facebook page messages', icon: <FacebookIcon className="w-5 h-5" />, color: 'text-[#1877F2]' },
  { key: 'IG', label: 'Instagram DMs', desc: 'Instagram direct messages', icon: <InstagramIcon className="w-5 h-5" />, color: 'text-[#E4405F]' },
  { key: 'GMB', label: 'Google Business', desc: 'Google Business Profile messages', icon: <GoogleIcon className="w-5 h-5" />, color: 'text-white' },
  { key: 'Live_Chat', label: 'Live Chat', desc: 'Website chat widget', icon: <LiveChatIcon className="w-5 h-5" />, color: 'text-violet-400' },
  { key: 'Email', label: 'Email', desc: 'Email conversations via LeadConnector', icon: <EmailIcon className="w-5 h-5" />, color: 'text-amber-400' },
]

const CHANNEL_LABELS: Record<string, string> = Object.fromEntries(
  CHANNELS.map(c => [c.key, c.label]),
)

const RULE_TYPE_LABEL: Record<string, string> = {
  ALL: 'All inbound',
  TAG: 'has tag',
  PIPELINE_STAGE: 'in pipeline stage',
  KEYWORD: 'message contains',
}

function summarizeRoutingRule(rule: RoutingRule): string {
  const groups = rule.conditions?.groups
  if (groups && groups.length > 0) {
    const summaries = groups.map(g => {
      const parts = g.clauses.map(c => {
        if (c.ruleType === 'ALL') return 'all inbound'
        const verb = (RULE_TYPE_LABEL[c.ruleType] ?? c.ruleType).toLowerCase()
        const negated = c.negate ? `does NOT ${verb}` : verb
        const vals = c.values?.length ? ` "${c.values.slice(0, 2).join('", "')}${c.values.length > 2 ? '…' : ''}"` : ''
        return `${negated}${vals}`
      })
      return parts.join(' AND ')
    })
    return summaries.join(' OR ')
  }
  if (rule.ruleType === 'ALL') return 'All inbound'
  return `${RULE_TYPE_LABEL[rule.ruleType] ?? rule.ruleType} ${rule.value ?? ''}`.trim()
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TriggerEditorPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  // Load everything in parallel.
  const [agent, setAgent] = useState<AgentDetails | null>(null)
  const [initialChannels, setInitialChannels] = useState<ChannelDeployment[] | null>(null)
  const [triggers, setTriggers] = useState<AgentTrigger[] | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`)
        .then(r => r.json())
        .then(d => setInitialChannels(d.deployments ?? []))
        .catch(() => setInitialChannels([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(d => setAgent({
          isActive: !!d.agent?.isActive,
          routingRules: d.agent?.routingRules ?? [],
          locationId: d.agent?.locationId ?? '',
        }))
        .catch(() => setAgent(null)),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`)
        .then(r => r.json())
        .then(d => setTriggers(d.triggers ?? []))
        .catch(() => setTriggers([])),
    ])
  }, [workspaceId, agentId])

  // Reload routing rules only — called after each per-channel filter
  // save so the freshly-saved rule's id, conditions, and channels[] are
  // all reflected back into the AgentDetails state without re-fetching
  // the whole agent payload.
  async function refetchRoutingRules() {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
      const d = await res.json()
      setAgent(prev => prev ? { ...prev, routingRules: d.agent?.routingRules ?? [] } : prev)
    } catch {
      // Soft-fail; the user can refresh manually if the inline state
      // gets out of sync.
    }
  }

  // ─── Channels save form ────────────────────────────────────────────────
  // useDirtyForm pattern matches every other agent sub-page: edit-then-save
  // via SaveBar instead of toggling each row independently.
  const initialChannelsState = useMemo(
    () => ({ channels: initialChannels ?? [] }),
    [initialChannels],
  )
  const { draft: channelDraft, replace: replaceChannelDraft, dirty: channelsDirty, saving: channelsSaving, savedAt: channelsSavedAt, error: channelsError, save: saveChannels } = useDirtyForm<{ channels: ChannelDeployment[] }>({
    initial: initialChannels === null ? null : initialChannelsState,
    onSave: async (state: { channels: ChannelDeployment[] }) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channels: CHANNELS.map(c => ({
            channel: c.key,
            isActive: state.channels.find((x: ChannelDeployment) => x.channel === c.key)?.isActive ?? false,
          })),
        }),
      })
      if (!res.ok) throw new Error('Failed to save channels')
      const { deployments } = await res.json()
      setInitialChannels(deployments)
    },
  })

  function toggleChannel(key: string, isActive: boolean) {
    if (!channelDraft) return
    const without = channelDraft.channels.filter(c => c.channel !== key)
    replaceChannelDraft({ channels: [...without, { channel: key, isActive }] })
  }

  // ─── CRM events (AgentTrigger) inline state ─────────────────────────────
  // Adds, edits, and deletes go straight to the API per-row (no batched
  // form) because each row has independent dirty-state.
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEvent, setNewEvent] = useState<Partial<AgentTrigger>>({
    eventType: 'ContactTagUpdate',
    tagFilter: '',
    channel: 'SMS',
    messageMode: 'AI_GENERATE',
    aiInstructions: '',
    fixedMessage: '',
    delaySeconds: 0,
    isActive: true,
  })
  const [savingNewEvent, setSavingNewEvent] = useState(false)

  async function createTrigger() {
    if (savingNewEvent) return
    if (newEvent.eventType === 'ContactTagUpdate' && !newEvent.tagFilter) return
    setSavingNewEvent(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newEvent),
      })
      if (!res.ok) throw new Error('Failed to create trigger')
      const { trigger } = await res.json()
      setTriggers(prev => [...(prev ?? []), trigger])
      setNewEventOpen(false)
      setNewEvent({
        eventType: 'ContactTagUpdate',
        tagFilter: '',
        channel: 'SMS',
        messageMode: 'AI_GENERATE',
        aiInstructions: '',
        fixedMessage: '',
        delaySeconds: 0,
        isActive: true,
      })
    } catch (err) {
      console.error('[trigger] create failed:', err)
    } finally {
      setSavingNewEvent(false)
    }
  }

  async function toggleTrigger(id: string, isActive: boolean) {
    // Optimistic — flip locally first, roll back if the PATCH 4xx's.
    setTriggers(prev => (prev ?? []).map(t => t.id === id ? { ...t, isActive } : t))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setTriggers(prev => (prev ?? []).map(t => t.id === id ? { ...t, isActive: !isActive } : t))
    }
  }

  async function deleteTrigger(id: string) {
    if (!confirm('Remove this trigger?')) return
    const prevState = triggers
    setTriggers(prev => (prev ?? []).filter(t => t.id !== id))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
    } catch {
      setTriggers(prevState)
    }
  }

  // ─── Loading & status banner ──────────────────────────────────────────
  const loading = initialChannels === null || agent === null || triggers === null
  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="h-28 rounded-xl animate-pulse"
              style={{ background: 'var(--surface-tertiary)' }}
            />
          ))}
        </div>
      </div>
    )
  }

  const activeChannelKeys = (channelDraft?.channels ?? []).filter(c => c.isActive).map(c => c.channel)
  const isListening = agent!.isActive && activeChannelKeys.length > 0 && agent!.routingRules.length > 0
  const banner = !agent!.isActive
    ? { tone: 'idle' as const,
        title: 'Agent is paused',
        body: 'No inbounds will be answered until you activate the agent.' }
    : activeChannelKeys.length === 0
    ? { tone: 'warn' as const,
        title: 'No channels enabled',
        body: 'The agent is active but isn\'t listening on any channel. Enable at least one channel below.' }
    : agent!.routingRules.length === 0
    ? { tone: 'warn' as const,
        title: 'No routing rules',
        body: 'The agent is active and has channels, but no routing rule. Inbounds will be skipped. Add a rule in Inbound filters below — "All inbound" if you want it to take everything.' }
    : { tone: 'live' as const,
        title: `Listening on ${activeChannelKeys.map(k => CHANNEL_LABELS[k] ?? k).join(', ')}`,
        body: 'When a contact messages on one of these channels and matches your inbound filters, this agent will respond. Configured CRM events below will also wake it up.' }

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Status banner */}
      <div
        className="rounded-xl border p-4"
        style={
          banner.tone === 'live'
            ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }
            : banner.tone === 'warn'
            ? { borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }
            : { borderColor: 'var(--border)', background: 'var(--surface-secondary)' }
        }
      >
        <p
          className="text-sm font-semibold mb-0.5"
          style={
            banner.tone === 'live' ? { color: 'var(--accent-emerald)' }
            : banner.tone === 'warn' ? { color: 'var(--accent-amber)' }
            : { color: 'var(--text-secondary)' }
          }
        >
          {banner.title}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{banner.body}</p>
      </div>

      {/* ─── Section 1: Channels ────────────────────────────────────── */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <header className="mb-4">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Channels</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
            Which inboxes this agent listens on. Turn off a channel to silence the agent on that inbox without disabling the whole agent.
          </p>
        </header>
        <div className="space-y-2">
          {CHANNELS.map(ch => {
            const isOn = channelDraft?.channels.some(c => c.channel === ch.key && c.isActive) ?? false
            // Find the routing rule scoped specifically to this channel.
            // Rules with empty channels[] are global (managed on /routing)
            // and don't surface here. Multi-channel rules ([SMS, FB]) are
            // also a /routing concept and not editable inline.
            const existingRule = (agent!.routingRules.find(r => {
              const chs = r.channels ?? []
              return chs.length === 1 && chs[0] === ch.key
            }) ?? null) as any
            return (
              <div
                key={ch.key}
                className="rounded-lg border px-3 py-2.5 transition-colors"
                style={{ borderColor: 'var(--border)', background: isOn ? 'var(--surface-secondary)' : 'transparent' }}
              >
                <label className="flex items-center justify-between gap-3 cursor-pointer">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`shrink-0 ${ch.color}`}>{ch.icon}</div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{ch.label}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>{ch.desc}</p>
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={isOn}
                    onChange={(e) => toggleChannel(ch.key, e.target.checked)}
                    className="shrink-0 w-4 h-4 accent-orange-500"
                  />
                </label>
                {/* Per-channel filter — appears only when channel is on.
                    A channel without a saved rule scoped to it WILL NOT
                    fire (routing engine requires ≥1 matching rule). The
                    builder makes that explicit by warning until the
                    user saves either "All inbound" or a filter. */}
                {isOn && (
                  <ChannelFilterBuilder
                    channel={ch.key}
                    channelLabel={ch.label}
                    workspaceId={workspaceId}
                    agentId={agentId}
                    locationId={agent!.locationId}
                    existingRule={existingRule}
                    onChanged={refetchRoutingRules}
                  />
                )}
              </div>
            )
          })}
        </div>
        {/* Global / multi-channel rules still live on /routing for
            power users. The inline editor above covers the 95% case
            (one rule per channel). */}
        {agent!.routingRules.some(r => (r.channels ?? []).length !== 1) && (
          <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
            This agent also has rules that apply across multiple channels.{' '}
            <Link
              href={`${base}/routing`}
              className="underline"
              style={{ color: 'var(--text-secondary)' }}
            >
              Manage advanced rules →
            </Link>
          </p>
        )}
      </section>

      {/* ─── Section 3: CRM events ──────────────────────────────────── */}
      <section className="rounded-xl border p-5" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>CRM events</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              The agent should also take over when something happens in your CRM. Common pattern: a workflow adds a tag, the agent picks up from there and reviews the conversation.
            </p>
          </div>
          {!newEventOpen && (
            <button
              type="button"
              onClick={() => setNewEventOpen(true)}
              className="shrink-0 text-xs font-medium px-3 py-1.5 rounded whitespace-nowrap"
              style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
            >
              + Add event
            </button>
          )}
        </header>

        {/* Existing triggers */}
        {(triggers ?? []).length === 0 && !newEventOpen ? (
          <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No CRM events yet. This agent only responds to inbound messages. Add an event above to have it take over when, e.g., a contact gets tagged with <span className="font-mono">handoff-to-ai</span>.
          </p>
        ) : (
          <ul className="space-y-2">
            {(triggers ?? []).map(t => {
              const eventLabel = t.eventType === 'ContactCreate'
                ? 'New contact created'
                : `Tag added: ${t.tagFilter || '(any)'}`
              const modeLabel = t.messageMode === 'FIXED' ? 'sends fixed message' : 'AI generates a message reviewing the conversation'
              return (
                <li
                  key={t.id}
                  className="rounded-lg border p-3 flex items-start justify-between gap-3"
                  style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                      {eventLabel}
                    </p>
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      On {CHANNEL_LABELS[t.channel] ?? t.channel} · {modeLabel}
                      {t.delaySeconds > 0 ? ` · delay ${t.delaySeconds}s` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <label className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                      <input
                        type="checkbox"
                        checked={t.isActive}
                        onChange={(e) => toggleTrigger(t.id, e.target.checked)}
                        className="w-3.5 h-3.5 accent-orange-500"
                      />
                      Active
                    </label>
                    <button
                      type="button"
                      onClick={() => deleteTrigger(t.id)}
                      className="text-[11px] px-2 py-1 rounded border hover:border-rose-700 hover:text-rose-300 transition-colors"
                      style={{ borderColor: 'var(--border)', color: 'var(--text-tertiary)' }}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        {/* Add-event panel */}
        {newEventOpen && (
          <div className="mt-3 rounded-lg border p-4 space-y-3" style={{ borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }}>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewEvent(p => ({ ...p, eventType: 'ContactTagUpdate' }))}
                className="text-left rounded-lg border px-3 py-2"
                style={
                  newEvent.eventType === 'ContactTagUpdate'
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { borderColor: 'var(--border)', background: 'transparent' }
                }
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Tag added</p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Fires when a specific tag is added to a contact</p>
              </button>
              <button
                type="button"
                onClick={() => setNewEvent(p => ({ ...p, eventType: 'ContactCreate' }))}
                className="text-left rounded-lg border px-3 py-2"
                style={
                  newEvent.eventType === 'ContactCreate'
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { borderColor: 'var(--border)', background: 'transparent' }
                }
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>New contact</p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Fires when a contact is created (form, import, API)</p>
              </button>
            </div>

            {newEvent.eventType === 'ContactTagUpdate' && (
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Tag</label>
                <div className="mt-1">
                  <TagCombobox
                    workspaceId={workspaceId}
                    locationId={agent!.locationId}
                    value={newEvent.tagFilter ?? ''}
                    onChange={(value: string) => setNewEvent(p => ({ ...p, tagFilter: value }))}
                    placeholder="Choose or type a tag..."
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Send via channel</label>
              <select
                value={newEvent.channel}
                onChange={(e) => setNewEvent(p => ({ ...p, channel: e.target.value }))}
                className="mt-1 w-full text-sm px-3 py-2 rounded border"
                style={{ borderColor: 'var(--border)', background: 'var(--input-bg)', color: 'var(--input-text)' }}
              >
                {CHANNELS.map(c => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setNewEvent(p => ({ ...p, messageMode: 'AI_GENERATE' }))}
                className="text-left rounded-lg border px-3 py-2"
                style={
                  newEvent.messageMode === 'AI_GENERATE'
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { borderColor: 'var(--border)', background: 'transparent' }
                }
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>AI generates</p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Reviews the conversation, decides what to say</p>
              </button>
              <button
                type="button"
                onClick={() => setNewEvent(p => ({ ...p, messageMode: 'FIXED' }))}
                className="text-left rounded-lg border px-3 py-2"
                style={
                  newEvent.messageMode === 'FIXED'
                    ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                    : { borderColor: 'var(--border)', background: 'transparent' }
                }
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Fixed message</p>
                <p className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Send a templated first message verbatim</p>
              </button>
            </div>

            {newEvent.messageMode === 'AI_GENERATE' ? (
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>What should the agent say?</label>
                <MergeFieldTextarea
                  value={newEvent.aiInstructions ?? ''}
                  onChange={(e) => setNewEvent(p => ({ ...p, aiInstructions: e.target.value }))}
                  onValueChange={(v: string) => setNewEvent(p => ({ ...p, aiInstructions: v }))}
                  placeholder="e.g. Pick up the conversation. Summarise where it left off, then ask if they want to schedule a follow-up call."
                  rows={3}
                />
              </div>
            ) : (
              <div>
                <label className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Message text</label>
                <MergeFieldTextarea
                  value={newEvent.fixedMessage ?? ''}
                  onChange={(e) => setNewEvent(p => ({ ...p, fixedMessage: e.target.value }))}
                  onValueChange={(v: string) => setNewEvent(p => ({ ...p, fixedMessage: v }))}
                  placeholder="Hi {{contact.first_name}}, just following up..."
                  rows={3}
                />
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={createTrigger}
                disabled={savingNewEvent || (newEvent.eventType === 'ContactTagUpdate' && !newEvent.tagFilter)}
                className="text-xs font-medium px-3 py-1.5 rounded disabled:opacity-50"
                style={{ background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
              >
                {savingNewEvent ? 'Adding...' : 'Add event'}
              </button>
              <button
                type="button"
                onClick={() => setNewEventOpen(false)}
                className="text-xs px-3 py-1.5 rounded border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Sticky save bar for the channels section (matches the rest of the
          agent sub-pages — SaveBar is the canonical save UI). */}
      <SaveBar
        dirty={channelsDirty}
        saving={channelsSaving}
        savedAt={channelsSavedAt}
        error={channelsError}
        onSave={() => void saveChannels()}
      />
    </div>
  )
}
