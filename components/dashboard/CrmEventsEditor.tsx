'use client'

/**
 * Inline editor for AgentTrigger rows ("CRM events" — the third
 * section on /trigger). Extracted out of trigger/page.tsx so the page
 * stops doubling as a 700-line trigger CRUD; the section is fully
 * self-contained and manages its own data lifecycle.
 *
 * Two failure surfaces it specifically handles:
 *   - Optimistic toggle/delete rejected by the server (token expired,
 *     plan limit, race): rolls back state AND surfaces a banner so
 *     the user knows the change reverted.
 *   - Network failure on the create POST: error logged + caught,
 *     "Add event" button re-enables instead of leaving the modal in
 *     a saving spinner forever.
 */

import { useEffect, useState } from 'react'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon,
} from '@/components/icons/brand-icons'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import TagCombobox from '@/components/TagCombobox'

// Channel options accepted by AgentTrigger.channel. Kept here (not
// imported from /trigger page) so the editor is independently movable.
// SHOULD eventually live in a shared module; today the duplication is
// 7 short rows and not worth a separate file.
const CHANNELS = [
  { key: 'SMS',        label: 'SMS' },
  { key: 'WhatsApp',   label: 'WhatsApp' },
  { key: 'FB',         label: 'Facebook Messenger' },
  { key: 'IG',         label: 'Instagram DMs' },
  { key: 'GMB',        label: 'Google Business' },
  { key: 'Live_Chat',  label: 'Live Chat' },
  { key: 'Email',      label: 'Email' },
  // VOICE_CALL is a special channel that places an outbound phone
  // call via Vapi instead of sending a text message. The trigger's
  // messageMode/fixedMessage/aiInstructions are ignored — the call
  // IS the action. Pickers should only show this option when the
  // agent has a voice config with an active phone number; the
  // backend in lib/triggers.ts skips the trigger gracefully if the
  // contact has no phone number on file.
  { key: 'VOICE_CALL', label: '📞 Outbound phone call' },
] as const
const CHANNEL_LABELS: Record<string, string> = Object.fromEntries(CHANNELS.map(c => [c.key, c.label]))

// Icon lookup so toggling rows can show the channel icon. Not currently
// used in the list rows (we just render the label) but kept available
// for future visual polish — saves another extraction if we add it.
export const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  SMS:       <SmsIcon className="w-4 h-4" />,
  WhatsApp:  <WhatsAppIcon className="w-4 h-4" />,
  FB:        <FacebookIcon className="w-4 h-4" />,
  IG:        <InstagramIcon className="w-4 h-4" />,
  GMB:       <GoogleIcon className="w-4 h-4" />,
  Live_Chat: <LiveChatIcon className="w-4 h-4" />,
  Email:     <EmailIcon className="w-4 h-4" />,
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

interface Props {
  workspaceId: string
  agentId: string
  locationId: string
}

export default function CrmEventsEditor({ workspaceId, agentId, locationId }: Props) {
  const [triggers, setTriggers] = useState<AgentTrigger[] | null>(null)
  const [newEventOpen, setNewEventOpen] = useState(false)
  const [newEvent, setNewEvent] = useState<Partial<AgentTrigger>>(emptyEvent())
  const [savingNewEvent, setSavingNewEvent] = useState(false)
  const [triggerError, setTriggerError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`)
      .then(r => r.json())
      .then(d => setTriggers(d.triggers ?? []))
      .catch(err => {
        console.warn('[trigger] failed to fetch triggers', err?.message)
        setTriggers([])
      })
  }, [workspaceId, agentId])

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
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't create trigger (${res.status})`)
      }
      const { trigger } = await res.json()
      setTriggers(prev => [...(prev ?? []), trigger])
      setNewEventOpen(false)
      setNewEvent(emptyEvent())
      setTriggerError(null)
    } catch (err: any) {
      console.error('[trigger] create failed:', err)
      setTriggerError(err?.message ?? 'Could not create trigger.')
    } finally {
      setSavingNewEvent(false)
    }
  }

  async function toggleTrigger(id: string, isActive: boolean) {
    setTriggers(prev => (prev ?? []).map(t => t.id === id ? { ...t, isActive } : t))
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive }),
      })
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't update trigger (${res.status})`)
      }
      setTriggerError(null)
    } catch (err: any) {
      console.error('[trigger] toggle failed', { id, err: err?.message })
      setTriggers(prev => (prev ?? []).map(t => t.id === id ? { ...t, isActive: !isActive } : t))
      setTriggerError(err?.message ?? 'Could not update trigger — your change was reverted.')
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
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}))
        throw new Error(detail.error || `Couldn't delete trigger (${res.status})`)
      }
      setTriggerError(null)
    } catch (err: any) {
      console.error('[trigger] delete failed', { id, err: err?.message })
      setTriggers(prevState)
      setTriggerError(err?.message ?? 'Could not delete trigger — change reverted.')
    }
  }

  return (
    <section
      className="rounded-xl border p-5"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
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

      {triggerError && (
        <div
          className="mb-3 rounded-md border px-3 py-2 text-xs flex items-start justify-between gap-3"
          style={{
            borderColor: 'var(--accent-red)',
            background: 'var(--accent-red-bg)',
            color: 'var(--accent-red)',
          }}
        >
          <span>{triggerError}</span>
          <button
            type="button"
            onClick={() => setTriggerError(null)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

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
            const modeLabel = t.messageMode === 'FIXED'
              ? 'sends fixed message'
              : 'AI generates a message reviewing the conversation'
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

      {newEventOpen && (
        <div
          className="mt-3 rounded-lg border p-4 space-y-3"
          style={{ borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }}
        >
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
                  locationId={locationId}
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
  )
}

function emptyEvent(): Partial<AgentTrigger> {
  return {
    eventType: 'ContactTagUpdate',
    tagFilter: '',
    channel: 'SMS',
    messageMode: 'AI_GENERATE',
    aiInstructions: '',
    fixedMessage: '',
    delaySeconds: 0,
    isActive: true,
  }
}
