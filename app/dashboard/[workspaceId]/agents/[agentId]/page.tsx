'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDirtyForm } from '@/lib/use-dirty-form'
import NewBadge from '@/components/NewBadge'

/**
 * Agent Identity / overview page — mockup-faithful sectioned layout.
 *
 * Replaces the old Settings/System-Prompt-only editor with a single
 * scrollable page composed of section cards (Identity / Knowledge /
 * Actions / Handoff / Channels). Each section uses a two-column shell:
 * a left column with the heading + description, and a right column
 * with the actual editable controls.
 *
 * Editable on this page: agent name + persona description (mapped to
 * systemPrompt for now). Knowledge / Actions / Handoff / Channels
 * sections summarise live state and deep-link out to the existing
 * sub-pages for full editing.
 */

interface VocabRow {
  never: string
  sayInstead: string
}

interface AgentRecord {
  name: string
  systemPrompt: string
  /** Extra operator guidance ("Additional Information" in HighLevel). */
  instructions: string
  isActive: boolean
  enabledTools: string[]
  fallbackBehavior: 'message' | 'transfer' | 'message_and_transfer'
  agentPersonaName: string | null
  /** Never-say guardrails — the rules that were being ignored on the CRM path. */
  vocabularyRules: VocabRow[]
  // ─── Auto-pilot mode ───
  autopilotWaitSeconds: number | null
  maxBotMessages: number | null
  respondToImages: boolean
  respondToVoiceNotes: boolean
  sleepOnManualMessage: boolean
  sleepOnWorkflowMessage: boolean
}

interface KnowledgeSource {
  id: string
  name: string
  type: string
  syncedAt: string | null
}

interface ChannelDeployment {
  channel: string
  isActive: boolean
}

const ACTION_LABELS: Record<string, { label: string; desc: string }> = {
  send_reply: { label: 'Send reply', desc: 'Reply to inbound messages on any channel' },
  send_sms: { label: 'Send SMS', desc: 'Compose and send SMS messages' },
  send_email: { label: 'Send email', desc: 'Compose and send emails to the contact' },
  get_contact_details: { label: 'Look up contact details', desc: 'Fetch CRM info before replying' },
  update_contact_tags: { label: 'Tag the contact', desc: 'Add tags based on the conversation' },
  remove_contact_tags: { label: 'Remove tags', desc: 'Strip tags when the conversation moves on' },
  get_opportunities: { label: 'Look up opportunities', desc: 'Pull open deals for the contact' },
  upsert_opportunity: { label: 'Create or update an opportunity', desc: 'Move deal forward in the pipeline' },
  move_opportunity_stage: { label: 'Move opportunity stage', desc: 'Advance deals through your pipeline' },
  mark_opportunity_won: { label: 'Mark opportunity won', desc: 'Close a deal as won' },
  mark_opportunity_lost: { label: 'Mark opportunity lost', desc: 'Close a deal as lost' },
  add_contact_note: { label: 'Add a note', desc: 'Leave a note on the contact record' },
  get_available_slots: { label: 'Check calendar availability', desc: 'Find open slots before booking' },
  book_appointment: { label: 'Book an appointment', desc: 'Schedule a time with the contact' },
  cancel_appointment: { label: 'Cancel an appointment', desc: 'Cancel previously-booked appointments' },
  reschedule_appointment: { label: 'Reschedule an appointment', desc: 'Move existing bookings' },
  create_appointment_note: { label: 'Add appointment note', desc: 'Annotate booked appointments' },
  get_calendar_events: { label: 'Read calendar events', desc: 'See upcoming events on the calendar' },
  find_contact_by_email_or_phone: { label: 'Find contact by email/phone', desc: 'Look up before creating a duplicate' },
  upsert_contact: { label: 'Create or update contact', desc: 'Capture lead details into your CRM' },
  create_task: { label: 'Create a task', desc: 'Queue a task for the team' },
  add_to_workflow: { label: 'Add to workflow', desc: 'Trigger an automation' },
  remove_from_workflow: { label: 'Remove from workflow', desc: 'Pull the contact out of an automation' },
  cancel_scheduled_message: { label: 'Cancel a scheduled message', desc: 'Stop a queued send' },
  list_contact_conversations: { label: 'List past conversations', desc: 'See previous threads with this contact' },
  list_pipelines: { label: 'List pipelines', desc: 'See available CRM pipelines' },
}

const CHANNEL_BADGES: Record<string, { label: string; color: string }> = {
  SMS: { label: 'SMS', color: 'var(--accent-blue)' },
  WhatsApp: { label: 'WhatsApp', color: '#25D366' },
  FB: { label: 'Facebook Messenger', color: '#1877F2' },
  IG: { label: 'Instagram DMs', color: '#E4405F' },
  GMB: { label: 'Google Business', color: 'var(--text-secondary)' },
  Live_Chat: { label: 'Website chat', color: 'var(--accent-amber)' },
  Email: { label: 'Email', color: 'var(--accent-primary)' },
}

export default function AgentIdentityPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [loading, setLoading] = useState(true)
  const [initial, setInitial] = useState<AgentRecord | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeSource[]>([])
  const [channels, setChannels] = useState<ChannelDeployment[]>([])
  const [stopConditions, setStopConditions] = useState<{ conditionType: string; value: string | null }[]>([])
  const [autopilotPending, setAutopilotPending] = useState(false)
  // Agent type (reactive vs procedural). Managed outside the dirty-form
  // because switching it is a structural change applied immediately — it
  // reveals/hides the Procedure tab in the layout.
  const [kind, setKind] = useState<'reactive' | 'procedural'>('reactive')
  const [procMode, setProcMode] = useState<'simple' | 'advanced'>('simple')
  const [kindSaving, setKindSaving] = useState(false)
  // Track an in-flight redirect to /flow so we can keep the loading
  // spinner up instead of flashing the Identity page for a frame before
  // the route swap lands.
  const [redirectingToFlow, setRedirectingToFlow] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/knowledge`).then(r => r.json()).catch(() => ({})),
      // Real handoff config lives in Stop Conditions — the "Handoff to human"
      // card below reflects these instead of hardcoded toggle state.
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions`).then(r => r.json()).catch(() => ({})),
    ])
      .then(([agentRes, channelsRes, knowledgeRes, stopCondRes]) => {
        const agent = agentRes.agent
        // Advanced-mode short-circuit. When the agent is configured to
        // render as a canvas, the root URL should land directly on /flow
        // rather than the Identity page — the operator never picked
        // Identity, they picked Advanced. We use router.replace (not
        // push) so the back button doesn't re-loop them through the
        // Identity page they never wanted to see.
        if (agent?.viewMode === 'advanced') {
          setRedirectingToFlow(true)
          router.replace(`${base}/flow`)
          return
        }
        if (agent) {
          // Vocabulary rows = saved rules + any legacy never-say terms
          // (same merge the Persona page uses so both surfaces agree).
          const rules: VocabRow[] = Array.isArray(agent.vocabularyRules)
            ? agent.vocabularyRules
                .filter((r: any) => r && typeof r.never === 'string' && r.never.trim())
                .map((r: any) => ({ never: r.never, sayInstead: typeof r.sayInstead === 'string' ? r.sayInstead : '' }))
            : []
          const known = new Set(rules.map(r => r.never.toLowerCase()))
          for (const term of (agent.neverSayList ?? []) as string[]) {
            if (typeof term === 'string' && term.trim() && !known.has(term.trim().toLowerCase())) {
              rules.push({ never: term.trim(), sayInstead: '' })
            }
          }
          setInitial({
            name: agent.name ?? '',
            systemPrompt: agent.systemPrompt ?? '',
            instructions: agent.instructions ?? '',
            isActive: agent.isActive ?? true,
            enabledTools: agent.enabledTools ?? [],
            fallbackBehavior: agent.fallbackBehavior ?? 'message',
            agentPersonaName: agent.agentPersonaName ?? null,
            vocabularyRules: rules,
            autopilotWaitSeconds: agent.autopilotWaitSeconds ?? null,
            maxBotMessages: agent.maxBotMessages ?? null,
            respondToImages: agent.respondToImages ?? false,
            respondToVoiceNotes: agent.respondToVoiceNotes ?? false,
            sleepOnManualMessage: agent.sleepOnManualMessage ?? false,
            sleepOnWorkflowMessage: agent.sleepOnWorkflowMessage ?? false,
          })
          setKind(agent.agentKind === 'procedural' ? 'procedural' : 'reactive')
          setProcMode(agent.procedureMode === 'advanced' ? 'advanced' : 'simple')
        }
        if (Array.isArray(channelsRes.deployments)) setChannels(channelsRes.deployments)
        if (Array.isArray(stopCondRes.conditions)) setStopConditions(stopCondRes.conditions)
        // Knowledge endpoint shape varies — try a few common keys.
        const ks = knowledgeRes.collections ?? knowledgeRes.knowledge ?? knowledgeRes.entries ?? []
        if (Array.isArray(ks)) {
          setKnowledge(ks.slice(0, 6).map((k: any) => ({
            id: k.id,
            name: k.name ?? k.title ?? 'Untitled',
            type: k.type ?? 'collection',
            syncedAt: k.syncedAt ?? k.updatedAt ?? null,
          })))
        }
      })
      .finally(() => setLoading(false))
  }, [workspaceId, agentId, base, router])

  const { draft, set, dirty, saving, savedAt, error, save, reset } = useDirtyForm<AgentRecord>({
    initial,
    onSave: async (d) => {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: d.name,
          systemPrompt: d.systemPrompt,
          instructions: d.instructions,
          agentPersonaName: d.agentPersonaName || null,
          // vocabularyRules is the source of truth; neverSayList keeps
          // carrying the replacement-less terms for back-compat. The PATCH
          // route re-parses both through the single validator.
          vocabularyRules: d.vocabularyRules
            .filter(r => r.never.trim())
            .map(r => ({ never: r.never.trim(), sayInstead: r.sayInstead.trim() || null })),
          neverSayList: d.vocabularyRules
            .filter(r => r.never.trim() && !r.sayInstead.trim())
            .map(r => r.never.trim()),
          autopilotWaitSeconds: d.autopilotWaitSeconds,
          maxBotMessages: d.maxBotMessages,
          respondToImages: d.respondToImages,
          respondToVoiceNotes: d.respondToVoiceNotes,
          sleepOnManualMessage: d.sleepOnManualMessage,
          sleepOnWorkflowMessage: d.sleepOnWorkflowMessage,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

  // Vocabulary (never-say) editors — mirror the Persona page helpers.
  function updateRule(idx: number, patch: Partial<VocabRow>) {
    if (!draft) return
    set({ vocabularyRules: draft.vocabularyRules.map((r, i) => i === idx ? { ...r, ...patch } : r) })
  }
  function removeRule(idx: number) {
    if (!draft) return
    set({ vocabularyRules: draft.vocabularyRules.filter((_, i) => i !== idx) })
  }
  function addRule() {
    if (!draft) return
    set({ vocabularyRules: [...draft.vocabularyRules, { never: '', sayInstead: '' }] })
  }

  async function toggleAutopilot() {
    if (!draft) return
    setAutopilotPending(true)
    const next = !draft.isActive
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: next }),
      })
      if (res.ok) {
        // Mutate both initial + draft so the toggle reflects truth and
        // doesn't show as a "dirty" field.
        setInitial(prev => prev ? { ...prev, isActive: next } : prev)
        set({ isActive: next })
      }
    } finally {
      setAutopilotPending(false)
    }
  }

  async function changeKind(nextKind: 'reactive' | 'procedural', nextMode?: 'simple' | 'advanced') {
    setKindSaving(true)
    const prevKind = kind
    setKind(nextKind)
    if (nextMode) setProcMode(nextMode)
    try {
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentKind: nextKind, ...(nextMode ? { procedureMode: nextMode } : {}) }),
      })
      // The Procedure tab lives in the layout, which read agentKind once on
      // mount — reload so it appears/disappears to match the new kind.
      if (nextKind !== prevKind) router.refresh()
    } finally {
      setKindSaving(false)
    }
  }

  if (loading || redirectingToFlow || !initial || !draft) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          {redirectingToFlow ? 'Opening canvas…' : 'Loading agent…'}
        </p>
      </div>
    )
  }

  // Simple deterministic monogram avatar for the persona, coloured by name.
  const monogram = (draft.agentPersonaName || draft.name || 'A').charAt(0).toUpperCase()
  const avatarHue = ((draft.agentPersonaName || draft.name).charCodeAt(0) || 200) * 137 % 360

  const enabledActions = draft.enabledTools ?? []
  const liveChannels = channels.filter(c => c.isActive)

  // Real handoff state, derived from the agent's tools + Stop Conditions
  // (the actual backing config) rather than hardcoded toggle values.
  const asksForHumanOn = enabledActions.includes('transfer_to_human')
  const sentimentOn = stopConditions.some(c => c.conditionType === 'SENTIMENT')
  const messageCountCond = stopConditions.find(c => c.conditionType === 'MESSAGE_COUNT')

  return (
    <div className="pb-24" style={{ background: 'var(--background)' }}>
      {/* ─── Sticky header ─── */}
      <div
        className="sticky top-0 z-20 border-b backdrop-blur"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--background) 92%, transparent)',
        }}
      >
        <div className="max-w-5xl mx-auto px-8 py-5 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Agent
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              How your AI replies to customers across every channel
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={toggleAutopilot}
              disabled={autopilotPending}
              className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-60"
              style={
                draft.isActive
                  ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                  : { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }
              }
              title={draft.isActive ? 'Click to pause — agent will stop replying' : 'Click to activate — agent will reply on connected channels'}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: draft.isActive ? 'var(--accent-emerald)' : 'var(--text-muted)' }}
              />
              Autopilot {draft.isActive ? 'ON' : 'OFF'}
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!dirty || saving}
              className="inline-flex items-center justify-center rounded-lg text-sm font-semibold px-4 h-9 transition-colors"
              style={
                !dirty || saving
                  ? { background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)', cursor: 'not-allowed' }
                  : { background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }
              }
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
        {error && (
          <div
            className="max-w-5xl mx-auto px-8 pb-3 text-xs"
            style={{ color: 'var(--accent-red)' }}
          >
            {error}
          </div>
        )}
        {savedAt && !dirty && !saving && (
          <div
            className="max-w-5xl mx-auto px-8 pb-3 text-xs"
            style={{ color: 'var(--accent-emerald)' }}
          >
            Saved.
          </div>
        )}
      </div>

      {/* ─── Sections ─── */}
      <div className="max-w-5xl mx-auto px-8 py-8 space-y-8">
        {/* Identity */}
        <Section
          title="Identity"
          desc="How your agent introduces itself to the world."
        >
          <div className="rounded-2xl border p-6" style={cardStyle}>
            <div className="flex items-start gap-5">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center text-2xl font-bold shrink-0"
                style={{
                  background: `linear-gradient(135deg, hsl(${avatarHue}, 70%, 55%), hsl(${(avatarHue + 40) % 360}, 70%, 65%))`,
                  color: '#fff',
                }}
              >
                {monogram}
              </div>
              <div className="flex-1 min-w-0 space-y-4">
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    Agent name
                  </label>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={e => set({ name: e.target.value })}
                    placeholder="Bella"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    Persona description
                  </label>
                  <textarea
                    value={draft.systemPrompt}
                    onChange={e => set({ systemPrompt: e.target.value })}
                    rows={4}
                    placeholder="Friendly, knowledgeable assistant for…"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
                    style={fieldStyle}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    Additional instructions
                  </label>
                  <textarea
                    value={draft.instructions}
                    onChange={e => set({ instructions: e.target.value })}
                    rows={3}
                    placeholder="Extra rules, context, or guidance — e.g. always confirm the timezone, keep replies under 25 words…"
                    className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none resize-y"
                    style={fieldStyle}
                  />
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                    Layered on top of the persona. For hard bans, use the <strong>Guardrails</strong> section below — those are enforced on every reply.
                  </p>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                    Agent type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { k: 'reactive' as const, title: 'Reactive', desc: 'Answers & resolves — support, FAQ, triage. No steps.' },
                      { k: 'procedural' as const, title: 'Procedural', desc: 'Walks a defined sequence — onboarding, intake, booking.' },
                    ]).map(opt => (
                      <button key={opt.k} type="button" disabled={kindSaving}
                        onClick={() => changeKind(opt.k)}
                        className="text-left rounded-lg border p-3 transition-colors disabled:opacity-60"
                        style={kind === opt.k
                          ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                          : { borderColor: 'var(--border)' }}>
                        <p className="text-sm font-medium" style={{ color: kind === opt.k ? 'var(--accent-primary)' : 'var(--text-primary)' }}>{opt.title}</p>
                        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</p>
                      </button>
                    ))}
                  </div>
                  {kind === 'procedural' && (
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>Mode:</span>
                      {(['simple', 'advanced'] as const).map(m => (
                        <button key={m} type="button" disabled={kindSaving}
                          onClick={() => changeKind('procedural', m)}
                          className="text-xs px-2.5 py-1 rounded-md border capitalize transition-colors disabled:opacity-60"
                          style={procMode === m
                            ? { borderColor: 'var(--accent-primary)', color: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                            : { borderColor: 'var(--border)', color: 'var(--text-secondary)' }}>
                          {m}
                        </button>
                      ))}
                      <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>· Author steps in the <strong>Procedure</strong> tab.</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </Section>

        {/* Auto-pilot mode */}
        <Section
          title={<>Auto-pilot mode <NewBadge since="2026-07-19" /></>}
          desc="How the agent paces itself, what it responds to, and when it steps back for a human."
        >
          <div className="rounded-2xl border p-6 space-y-6" style={cardStyle}>
            {/* Wait time + max messages */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Wait time before responding
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0} max={60}
                    value={draft.autopilotWaitSeconds ?? ''}
                    onChange={e => set({ autopilotWaitSeconds: e.target.value === '' ? null : Math.max(0, Math.min(60, Number(e.target.value))) })}
                    placeholder="3"
                    className="w-24 rounded-lg px-3 py-2 text-sm focus:outline-none"
                    style={fieldStyle}
                  />
                  <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>seconds</span>
                </div>
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Batches rapid back-to-back messages into one reply. Blank = 3s default.
                </p>
              </div>
              <div>
                <label className="block text-[10px] font-semibold tracking-wider uppercase mb-1.5" style={{ color: 'var(--text-tertiary)' }}>
                  Max messages the agent can send
                </label>
                <Stepper
                  value={draft.maxBotMessages}
                  onChange={v => set({ maxBotMessages: v })}
                  min={0} max={999}
                />
                <p className="text-[11px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                  Pauses for a human after this many replies in a conversation. Blank = no cap.
                </p>
              </div>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--border)' }} />

            {/* Respond to */}
            <div>
              <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Also respond to</p>
              <div className="space-y-3">
                <ToggleRow
                  label="Images"
                  desc="Let the agent handle inbound photos / screenshots."
                  on={draft.respondToImages}
                  onChange={v => set({ respondToImages: v })}
                />
                <ToggleRow
                  label="Voice notes"
                  desc="Let the agent handle inbound audio messages."
                  on={draft.respondToVoiceNotes}
                  onChange={v => set({ respondToVoiceNotes: v })}
                />
              </div>
              <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
                When off, the agent skips these attachments instead of guessing at content it can't read.
              </p>
            </div>

            <div className="border-t" style={{ borderColor: 'var(--border)' }} />

            {/* Bot sleep — the double-booking fix */}
            <div>
              <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>Send the agent to sleep when I send a…</p>
              <p className="text-[11px] mb-3" style={{ color: 'var(--text-tertiary)' }}>
                Pauses the agent for that conversation until you turn it back on — so it never reacts to a booking
                confirmation or your own takeover message and double-books.
              </p>
              <div className="space-y-3">
                <ToggleRow
                  label="Manual message"
                  desc="You (or a teammate) reply by hand from the inbox."
                  on={draft.sleepOnManualMessage}
                  onChange={v => set({ sleepOnManualMessage: v })}
                />
                <ToggleRow
                  label="Workflow message"
                  desc="An automation / workflow sends a confirmation or follow-up."
                  on={draft.sleepOnWorkflowMessage}
                  onChange={v => set({ sleepOnWorkflowMessage: v })}
                />
              </div>
            </div>
          </div>
        </Section>

        {/* Guardrails — never say */}
        <Section
          title="Guardrails"
          desc="Words and phrases the agent must never use — enforced on every reply, even when your knowledge sources use them."
        >
          <div className="rounded-2xl border p-6" style={cardStyle}>
            {draft.vocabularyRules.length === 0 ? (
              <p className="text-sm mb-4" style={{ color: 'var(--text-tertiary)' }}>
                No guardrails yet. Add a term the agent should never say — optionally with a replacement it should use instead.
              </p>
            ) : (
              <div className="space-y-2 mb-4">
                <div className="grid grid-cols-[1fr_1fr_32px] gap-2 px-1">
                  <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-tertiary)' }}>Never say</span>
                  <span className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: 'var(--text-tertiary)' }}>Say instead (optional)</span>
                  <span />
                </div>
                {draft.vocabularyRules.map((rule, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_1fr_32px] gap-2 items-center">
                    <input
                      type="text" value={rule.never}
                      onChange={e => updateRule(idx, { never: e.target.value })}
                      placeholder="e.g. HighLevel"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={fieldStyle}
                    />
                    <input
                      type="text" value={rule.sayInstead}
                      onChange={e => updateRule(idx, { sayInstead: e.target.value })}
                      placeholder="e.g. your CRM"
                      className="w-full rounded-lg px-3 py-2 text-sm focus:outline-none"
                      style={fieldStyle}
                    />
                    <button
                      type="button" onClick={() => removeRule(idx)}
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-colors"
                      style={{ color: 'var(--text-tertiary)', background: 'var(--surface-tertiary)' }}
                      title="Remove rule"
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <button
              type="button" onClick={addRule}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors"
              style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}
            >
              <span style={{ fontSize: '15px', lineHeight: 1 }}>+</span> Add guardrail
            </button>
            <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
              Rules with a replacement are hard-enforced — the banned term is swapped out of the reply automatically, so it can never leak.
            </p>
          </div>
        </Section>

        {/* Knowledge */}
        <Section
          title="Knowledge"
          desc="What your agent knows about your business and operations."
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {knowledge.length === 0 ? (
              <KnowledgeEmpty href={`${base}/knowledge`} />
            ) : (
              knowledge.map(k => (
                <div key={k.id} className="rounded-xl border p-4" style={cardStyle}>
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>
                      <KnowledgeIcon />
                    </div>
                    <span
                      className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                      style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                    >
                      Synced
                    </span>
                  </div>
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{k.name}</p>
                  {k.syncedAt && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
                      {syncedLabel(k.syncedAt)}
                    </p>
                  )}
                </div>
              ))
            )}
            <Link
              href={`${base}/knowledge`}
              className="rounded-xl border-2 border-dashed p-4 flex items-center justify-center gap-2 text-sm font-medium transition-colors"
              style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}
            >
              <span style={{ fontSize: '16px' }}>+</span>
              Add knowledge source
            </Link>
          </div>
        </Section>

        {/* Actions */}
        <Section
          title="Actions"
          desc="Automated tasks your agent can perform during a conversation."
        >
          <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
            {Object.entries(ACTION_LABELS)
              .filter(([k]) => enabledActions.includes(k) || ['send_reply', 'get_contact_details', 'update_contact_tags', 'book_appointment', 'add_contact_note'].includes(k))
              .slice(0, 5)
              .map(([key, info], idx, arr) => {
                const active = enabledActions.includes(key)
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between gap-3 px-4 py-3 ${idx < arr.length - 1 ? 'border-b' : ''}`}
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{info.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{info.desc}</p>
                    </div>
                    <ToggleStatic on={active} />
                  </div>
                )
              })}
            <Link
              href={`${base}/tools`}
              className="block px-4 py-3 text-xs font-medium border-t text-center transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--accent-primary)', background: 'var(--surface-secondary)' }}
            >
              Configure all {enabledActions.length} actions →
            </Link>
          </div>
        </Section>

        {/* Handoff to human */}
        <Section
          title="Handoff to human"
          desc="When the agent should step back and ping your team."
        >
          <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
            <HandoffRow
              label="Customer asks for a human"
              desc={asksForHumanOn
                ? "Words like 'agent', 'representative', 'speak to someone' hand off"
                : "Turn on the Transfer to human tool to enable this"}
              on={asksForHumanOn}
              href={`${base}/tools`}
            />
            <HandoffRow
              label="Customer mentions a complaint or refund"
              desc={sentimentOn
                ? 'A Sentiment stop condition hands off on hostile / refund language'
                : 'Add a Sentiment stop condition to hand off on delicate situations'}
              on={sentimentOn}
              href={`${base}/goals`}
            />
            <HandoffRow
              label={messageCountCond?.value
                ? `Conversation goes &gt; ${messageCountCond.value} messages without resolution`
                : 'Conversation goes &gt; N messages without resolution'}
              desc={messageCountCond
                ? 'A Message Count stop condition pings your team if the agent is going in circles'
                : 'Add a Message Count stop condition to ping your team when the agent goes in circles'}
              on={!!messageCountCond}
              href={`${base}/goals`}
              isLast
            />
            <Link
              href={`${base}/goals`}
              className="block px-4 py-3 text-xs font-medium border-t text-center transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--accent-primary)', background: 'var(--surface-secondary)' }}
            >
              Manage handoff rules in Stop Conditions →
            </Link>
          </div>
        </Section>

        {/* Channels (read-only summary) */}
        <Section
          title="Channels"
          desc="Where this specific agent is currently live and replying."
        >
          <div className="rounded-2xl border p-5" style={cardStyle}>
            {liveChannels.length === 0 ? (
              <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
                Not deployed on any channels yet.{' '}
                <Link href={`${base}/deploy`} className="font-medium hover:underline" style={{ color: 'var(--accent-primary)' }}>
                  Deploy this agent →
                </Link>
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-2">
                  {liveChannels.map(c => {
                    const meta = CHANNEL_BADGES[c.channel] ?? { label: c.channel, color: 'var(--text-secondary)' }
                    return (
                      <span
                        key={c.channel}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border"
                        style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full" style={{ background: meta.color }} />
                        {meta.label}
                      </span>
                    )
                  })}
                </div>
                <Link
                  href={`${base}/deploy`}
                  className="inline-block mt-4 text-xs font-medium hover:underline"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  Manage in Channels →
                </Link>
              </>
            )}
          </div>
        </Section>

        {/* Reset link if dirty */}
        {dirty && (
          <div className="text-center">
            <button
              type="button"
              onClick={reset}
              className="text-xs font-medium hover:underline"
              style={{ color: 'var(--text-tertiary)' }}
            >
              Discard changes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Style tokens ─────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--surface)',
  borderColor: 'var(--border)',
}

const fieldStyle: React.CSSProperties = {
  background: 'var(--input-bg)',
  color: 'var(--input-text)',
  border: '1px solid var(--input-border)',
}

// ─── Subcomponents ────────────────────────────────────────────────────────

function Section({ title, desc, children }: { title: React.ReactNode; desc: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-x-8 gap-y-3 items-start">
      <div className="md:pt-1">
        <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Interactive labelled toggle row (unlike ToggleStatic, this one flips). */
function ToggleRow({ label, desc, on, onChange }: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</p>
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        onClick={() => onChange(!on)}
        className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
        style={{ background: on ? 'var(--accent-emerald)' : 'var(--toggle-off-bg)' }}
      >
        <span
          className={`inline-block h-4 w-4 rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`}
          style={{ background: 'var(--btn-primary-text)' }}
        />
      </button>
    </div>
  )
}

/** Number stepper with −/+ buttons. Null value renders empty (= no cap). */
function Stepper({ value, onChange, min, max }: { value: number | null; onChange: (v: number | null) => void; min: number; max: number }) {
  const step = (delta: number) => {
    const cur = value ?? 0
    const next = Math.max(min, Math.min(max, cur + delta))
    onChange(next)
  }
  return (
    <div className="inline-flex items-stretch rounded-lg overflow-hidden" style={{ border: '1px solid var(--input-border)' }}>
      <button type="button" onClick={() => step(-1)} className="w-9 flex items-center justify-center text-base transition-colors"
        style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>−</button>
      <input
        type="number" min={min} max={max}
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? null : Math.max(min, Math.min(max, Number(e.target.value))))}
        placeholder="∞"
        className="w-16 text-center text-sm focus:outline-none"
        style={{ background: 'var(--input-bg)', color: 'var(--input-text)' }}
      />
      <button type="button" onClick={() => step(1)} className="w-9 flex items-center justify-center text-base transition-colors"
        style={{ background: 'var(--surface-tertiary)', color: 'var(--text-secondary)' }}>+</button>
    </div>
  )
}

function ToggleStatic({ on }: { on: boolean }) {
  return (
    <span
      className="relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors"
      style={{ background: on ? 'var(--accent-primary)' : 'var(--toggle-off-bg)' }}
      aria-hidden
    >
      <span
        className={`inline-block h-4 w-4 mt-0.5 rounded-full shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0.5'}`}
        style={{ background: '#fff' }}
      />
    </span>
  )
}

function HandoffRow({ label, desc, on, href, isLast }: { label: string; desc: string; on: boolean; href?: string; isLast?: boolean }) {
  const cls = `flex items-center justify-between gap-3 px-4 py-3 ${!isLast ? 'border-b' : ''}`
  const inner = (
    <>
      <div className="min-w-0">
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
          dangerouslySetInnerHTML={{ __html: label }}
        />
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Status reflects the real backing config (tool / stop condition),
            it is not an in-place switch — the row links to the editor. */}
        <span className="text-[11px] font-medium" style={{ color: on ? 'var(--accent-emerald)' : 'var(--text-muted)' }}>
          {on ? 'On' : 'Off'}
        </span>
        <ToggleStatic on={on} />
      </div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className={`${cls} transition-colors hover:bg-[var(--surface-secondary)]`} style={{ borderColor: 'var(--border)' }}>
        {inner}
      </Link>
    )
  }
  return <div className={cls} style={{ borderColor: 'var(--border)' }}>{inner}</div>
}

function KnowledgeEmpty({ href }: { href: string }) {
  return (
    <Link
      href={href}
      className="rounded-xl border p-4 transition-colors"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="w-8 h-8 rounded-lg flex items-center justify-center mb-2" style={{ background: 'var(--surface-tertiary)', color: 'var(--text-tertiary)' }}>
        <KnowledgeIcon />
      </div>
      <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No knowledge yet</p>
      <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>
        Connect your website, product catalog, or upload docs.
      </p>
    </Link>
  )
}

function KnowledgeIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

function syncedLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.floor(ms / 60000)
  if (m < 60) return `Synced ${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `Synced ${h}h ago`
  const d = Math.floor(h / 24)
  return `Synced ${d}d ago`
}
