'use client'

/**
 * Skills Overview — landing for the Skills hub.
 *
 * Surfaces every system that controls what the agent can DO:
 *   • Tools          — CRM actions the agent can call
 *   • Integrations   — calendar, voice, etc.
 *   • Follow-ups     — outbound sequences this agent can schedule
 *   • Stop conditions — circuit breakers that pause the conversation
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint, Tag } from '@/components/dashboard/AgentOverview'

interface AgentSkills {
  enabledTools: string[]
  calendarId: string | null
}
interface FollowUpSequence { id: string; name: string; isActive: boolean }
interface StopCondition { id: string; name: string; isActive: boolean }

const TOOL_LABEL: Record<string, string> = {
  send_reply: 'Send reply',
  send_sms: 'Send SMS',
  get_contact_details: 'Read contact',
  update_contact_field: 'Update contact field',
  update_contact_tags: 'Add tags',
  remove_contact_tags: 'Remove tags',
  update_contact_memory: 'Capture context',
  get_opportunities: 'Read opportunities',
  move_opportunity_stage: 'Move opportunity stage',
  add_contact_note: 'Add note',
  get_available_slots: 'Check calendar',
  book_appointment: 'Book appointment',
  search_contacts: 'Search contacts',
  find_contact_by_email_or_phone: 'Find contact',
  upsert_contact: 'Upsert contact',
  add_to_workflow: 'Enrol in workflow',
  remove_from_workflow: 'Remove from workflow',
  schedule_followup: 'Schedule follow-up',
  cancel_scheduled_message: 'Cancel scheduled message',
  get_calendar_events: 'List appointments',
  cancel_appointment: 'Cancel appointment',
  reschedule_appointment: 'Reschedule appointment',
  create_appointment_note: 'Add appointment note',
  transfer_to_human: 'Transfer to human',
}

export default function SkillsOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [agent, setAgent] = useState<AgentSkills | null>(null)
  const [followUps, setFollowUps] = useState<FollowUpSequence[] | null>(null)
  const [stopConditions, setStopConditions] = useState<StopCondition[] | null>(null)

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
    ])
  }, [workspaceId, agentId])

  if (agent === null || followUps === null || stopConditions === null) {
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

  return (
    <div className="p-8 max-w-3xl space-y-5">
      {/* Tools */}
      <OverviewSection
        title="Actions"
        subtitle="What the agent can DO during a conversation, beyond replying. Each enabled action is exposed to the model as a tool it can call."
        pill={
          agent.enabledTools.length > 0
            ? { tone: 'live', label: `${agent.enabledTools.length} enabled` }
            : { tone: 'warn', label: 'None' }
        }
        editHref={`${base}/tools`}
      >
        {agent.enabledTools.length === 0 ? (
          <EmptyHint>No actions enabled — the agent can only reply with text. Add tools to let it touch the CRM.</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {agent.enabledTools.map(t => (
              <Tag key={t}>{TOOL_LABEL[t] ?? t}</Tag>
            ))}
          </div>
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
          <EmptyHint>This agent doesn't use the calendar. Enable booking tools in Actions to wire one up.</EmptyHint>
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
