'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useDirtyForm } from '@/lib/use-dirty-form'

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

interface AgentRecord {
  name: string
  systemPrompt: string
  isActive: boolean
  enabledTools: string[]
  fallbackBehavior: 'message' | 'transfer' | 'message_and_transfer'
  agentPersonaName: string | null
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
    ])
      .then(([agentRes, channelsRes, knowledgeRes]) => {
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
          setInitial({
            name: agent.name ?? '',
            systemPrompt: agent.systemPrompt ?? '',
            isActive: agent.isActive ?? true,
            enabledTools: agent.enabledTools ?? [],
            fallbackBehavior: agent.fallbackBehavior ?? 'message',
            agentPersonaName: agent.agentPersonaName ?? null,
          })
          setKind(agent.agentKind === 'procedural' ? 'procedural' : 'reactive')
          setProcMode(agent.procedureMode === 'advanced' ? 'advanced' : 'simple')
        }
        if (Array.isArray(channelsRes.deployments)) setChannels(channelsRes.deployments)
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
          agentPersonaName: d.agentPersonaName || null,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed')
    },
  })

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
              desc="Words like 'agent', 'representative', 'speak to someone'"
              on={true}
            />
            <HandoffRow
              label="Customer mentions a complaint or refund"
              desc="Triggers handoff for delicate situations"
              on={draft.fallbackBehavior !== 'message'}
            />
            <HandoffRow
              label="Conversation goes &gt; 5 messages without resolution"
              desc="Pings your team if the agent is going in circles"
              on={false}
              isLast
            />
            <Link
              href={`${base}/rules`}
              className="block px-4 py-3 text-xs font-medium border-t text-center transition-colors"
              style={{ borderColor: 'var(--border)', color: 'var(--accent-primary)', background: 'var(--surface-secondary)' }}
            >
              Manage handoff rules →
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

function Section({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-x-8 gap-y-3 items-start">
      <div className="md:pt-1">
        <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </div>
      <div className="min-w-0">{children}</div>
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

function HandoffRow({ label, desc, on, isLast }: { label: string; desc: string; on: boolean; isLast?: boolean }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 ${!isLast ? 'border-b' : ''}`}
      style={{ borderColor: 'var(--border)' }}
    >
      <div className="min-w-0">
        <p
          className="text-sm font-medium"
          style={{ color: 'var(--text-primary)' }}
          dangerouslySetInnerHTML={{ __html: label }}
        />
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{desc}</p>
      </div>
      <ToggleStatic on={on} />
    </div>
  )
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
