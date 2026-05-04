'use client'

/**
 * Skills Overview — landing for the Skills hub.
 *
 * Surfaces every system that controls what the agent can DO:
 *   • Reflexes       — tools the model uses freely during conversation
 *   • Playbook       — operator-authored "when X, do Y" CRM mutations
 *   • Integrations   — calendar wiring
 *   • Follow-ups     — outbound sequences this agent can schedule
 *   • Stop conditions — circuit breakers that pause the conversation
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint, Tag } from '@/components/dashboard/AgentOverview'
import { REFLEXES, getPlayAction, getReflex } from '@/lib/agent-tools-catalog'

interface AgentSkills {
  enabledTools: string[]
  calendarId: string | null
}
interface FollowUpSequence { id: string; name: string; isActive: boolean }
interface StopCondition { id: string; name: string; isActive: boolean }
interface Play { id: string; name: string; actionType: string; isActive: boolean }

// Tool labels are read from the catalog — single source of truth across
// the Reflexes editor, this Overview, and any future surfaces.
function reflexLabel(key: string): string {
  return getReflex(key)?.label ?? key
}

export default function SkillsOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [agent, setAgent] = useState<AgentSkills | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpSequence[] | null>(null)
  const [stopConditions, setStopConditions] = useState<StopCondition[] | null>(null)
  const [plays, setPlays] = useState<Play[] | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(d => setAgent({
          enabledTools: d.agent?.enabledTools ?? [],
          calendarId: d.agent?.calendarId ?? null,
        }))
        .catch(() => setAgent(null)),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/follow-up-sequences`)
        .then(r => r.json())
        .then(d => setFollowUps(d.sequences ?? []))
        .catch(() => setFollowUps([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/stop-conditions`)
        .then(r => r.json())
        .then(d => setStopConditions(d.conditions ?? []))
        .catch(() => setStopConditions([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/rules`)
        .then(r => r.json())
        .then(d => setPlays(d.rules ?? []))
        .catch(() => setPlays([])),
    ])
  }, [workspaceId, agentId])

  if (agent === null || followUps === null || stopConditions === null || plays === null) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-28 rounded-xl animate-pulse" style={{ background: 'var(--surface-tertiary)' }} />
          ))}
        </div>
      </div>
    )
  }

  // Calendar tools imply the agent should know how to book; calendarId
  // being set means a target calendar is wired up to actually do it.
  const bookingTools = ['get_available_slots', 'book_appointment']
  const wantsBooking = agent.enabledTools.some(t => bookingTools.includes(t))
  const calendarReady = wantsBooking && !!agent.calendarId
  const calendarMisconfigured = wantsBooking && !agent.calendarId

  const activeFollowUps = followUps.filter(f => f.isActive)
  const activeStopConditions = stopConditions.filter(s => s.isActive)

  // Reflexes are the read/reply tools enabled in enabledTools. We filter
  // to the catalog so legacy entries that aren't reflexes don't clutter
  // the count.
  const reflexKeys = new Set(REFLEXES.map(r => r.key))
  const enabledReflexes = agent.enabledTools.filter(t => reflexKeys.has(t))
  // Count required reflexes that are missing — those should be flagged.
  const requiredReflexes = REFLEXES.filter(r => r.required).map(r => r.key)
  const missingRequired = requiredReflexes.filter(k => !agent.enabledTools.includes(k))

  const activePlays = plays.filter(p => p.isActive)

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Reflexes — what the agent uses naturally */}
      <OverviewSection
        title="Reflexes"
        subtitle="Tools the agent uses naturally during a conversation — looking up contacts, replying, coordinating bookings. The model decides when each is appropriate."
        pill={
          missingRequired.length > 0
            ? { tone: 'warn', label: 'Required reflex off' }
            : enabledReflexes.length > 0
            ? { tone: 'live', label: `${enabledReflexes.length} enabled` }
            : { tone: 'warn', label: 'None' }
        }
        editHref={`${base}/tools`}
      >
        {missingRequired.length > 0 && (
          <p
            className="text-[11px] mb-2"
            style={{ color: 'var(--accent-amber)' }}
          >
            Missing: {missingRequired.map(reflexLabel).join(', ')}. The agent can\'t function without these.
          </p>
        )}
        {enabledReflexes.length === 0 ? (
          <EmptyHint>No reflexes enabled — the agent has no way to reply.</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {enabledReflexes.map(t => (
              <Tag key={t}>{reflexLabel(t)}</Tag>
            ))}
          </div>
        )}
      </OverviewSection>

      {/* Playbook — what the agent does deliberately */}
      <OverviewSection
        title="Playbook"
        subtitle="Specific actions the agent takes when specific things happen — pipeline stage changes, tag updates, deal values. Each Play is one trigger and one action, deterministic."
        pill={
          activePlays.length > 0
            ? { tone: 'live', label: `${activePlays.length} ${activePlays.length === 1 ? 'Play' : 'Plays'}` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/playbook`}
      >
        {activePlays.length === 0 ? (
          <EmptyHint>
            No Plays yet. Add some to make the agent change CRM data deliberately —
            e.g. "When the customer commits to buying, mark opportunity as Won."
          </EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activePlays.slice(0, 4).map(p => {
              const def = getPlayAction(p.actionType as any)
              return (
                <li key={p.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>•</span> {p.name || <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>(unnamed)</span>}
                  {def && (
                    <span style={{ color: 'var(--text-tertiary)' }}> — {def.label}</span>
                  )}
                </li>
              )
            })}
            {activePlays.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activePlays.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>

      {/* Calendar / Integrations */}
      <OverviewSection
        title="Calendar"
        subtitle="Required when the agent is supposed to book appointments — points at the calendar bookings land in."
        pill={
          calendarReady
            ? { tone: 'live', label: 'Connected' }
            : calendarMisconfigured
            ? { tone: 'warn', label: 'Booking tools on, no calendar' }
            : { tone: 'idle', label: 'Not used' }
        }
        editHref={`${base}/integrations`}
      >
        {calendarMisconfigured ? (
          <EmptyHint>
            Booking tools are enabled but no calendar is selected — the agent will say it booked an
            appointment but nothing will land in your calendar. Pick one in the integrations editor.
          </EmptyHint>
        ) : calendarReady ? (
          <OverviewRow
            label="Calendar ID"
            value={<span className="font-mono text-xs">{agent.calendarId}</span>}
          />
        ) : (
          <EmptyHint>This agent doesn't use the calendar. Enable booking reflexes in Reflexes to wire one up.</EmptyHint>
        )}
      </OverviewSection>

      {/* Follow-ups */}
      <OverviewSection
        title="Follow-ups"
        subtitle="Outbound sequences the agent can schedule when a contact goes quiet or asks to be contacted later."
        pill={
          activeFollowUps.length > 0
            ? { tone: 'info', label: `${activeFollowUps.length} active` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/follow-ups`}
      >
        {activeFollowUps.length === 0 ? (
          <EmptyHint>No follow-up sequences — the agent won't proactively re-engage stale conversations.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activeFollowUps.slice(0, 4).map(f => (
              <li key={f.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>•</span> {f.name}
              </li>
            ))}
            {activeFollowUps.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activeFollowUps.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>

      {/* Stop conditions */}
      <OverviewSection
        title="Stop conditions"
        subtitle="Circuit breakers that pause the conversation when something off happens — angry contact, off-topic, etc."
        pill={
          activeStopConditions.length > 0
            ? { tone: 'info', label: `${activeStopConditions.length} active` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/goals`}
      >
        {activeStopConditions.length === 0 ? (
          <EmptyHint>No stop conditions — the agent will keep trying even when it should hand off.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activeStopConditions.slice(0, 4).map(s => (
              <li key={s.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>•</span> {s.name}
              </li>
            ))}
            {activeStopConditions.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activeStopConditions.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>
    </div>
  )
}
