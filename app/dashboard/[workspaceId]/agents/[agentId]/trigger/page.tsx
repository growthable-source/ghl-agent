'use client'

/**
 * Trigger Overview — landing page for the Trigger hub.
 *
 * Shows the current state of every system that affects whether and when
 * this agent fires:
 *
 *   • Channels         — which inboxes the agent listens on
 *   • Routing rules    — which inbounds the agent claims
 *   • Detection rules  — what the agent does when it spots something
 *   • Working hours    — when the agent can proactively reach out
 *   • Proactive        — CRM events that start the conversation
 *
 * Each card shows a one-glance status with a deep-link to the full editor
 * for that area. The page is read-only — saves still happen on the
 * specialised sub-pages.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { OverviewSection, OverviewRow, EmptyHint, Tag } from '@/components/dashboard/AgentOverview'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ChannelDeployment { channel: string; isActive: boolean }

interface RoutingRule {
  id: string
  ruleType: string
  value: string | null
  conditions: { groups?: { clauses: { ruleType: string; values: string[]; negate?: boolean }[] }[] } | null
}

interface ContactTrigger {
  id: string
  eventType: string
  tagFilter: string | null
  channel: string
  messageMode: string
  isActive: boolean
}

interface AgentDetails {
  isActive: boolean
  workingHoursEnabled: boolean
  workingHoursStart: number | null
  workingHoursEnd: number | null
  workingDays: string[] | null
  timezone: string | null
  routingRules: RoutingRule[]
}

// ─── Constants ──────────────────────────────────────────────────────────────

const CHANNEL_LABELS: Record<string, string> = {
  SMS: 'SMS', WhatsApp: 'WhatsApp', FB: 'Facebook',
  IG: 'Instagram', GMB: 'Google Business', Live_Chat: 'Live Chat', Email: 'Email',
}

const ALL_CHANNELS = ['SMS', 'WhatsApp', 'FB', 'IG', 'GMB', 'Live_Chat', 'Email']

const RULE_TYPE_LABEL: Record<string, string> = {
  ALL: 'All inbound',
  TAG: 'has tag',
  PIPELINE_STAGE: 'in pipeline stage',
  KEYWORD: 'message contains',
}

const DAY_LABEL: Record<string, string> = {
  mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun',
}
const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtHour(h: number): string {
  if (h === 0) return '12am'
  if (h === 12) return '12pm'
  if (h === 24) return '12am (next day)'
  return h < 12 ? `${h}am` : `${h - 12}pm`
}

function fmtDays(days: string[]): string {
  if (!days || days.length === 0) return 'No days set'
  if (days.length === 7) return 'Every day'
  // Detect Mon–Fri
  const ordered = [...days].sort((a, b) => DAY_ORDER.indexOf(a) - DAY_ORDER.indexOf(b))
  const isWeekdays = ordered.length === 5 && ['mon','tue','wed','thu','fri'].every(d => ordered.includes(d))
  if (isWeekdays) return 'Mon–Fri'
  return ordered.map(d => DAY_LABEL[d] ?? d).join(', ')
}

function summarizeRoutingRule(rule: RoutingRule): string {
  // Prefer the modern groups[] shape; fall back to legacy ruleType/value.
  const groups = rule.conditions?.groups
  if (groups && groups.length > 0) {
    const groupSummaries = groups.map(g => {
      const parts = g.clauses.map(c => {
        if (c.ruleType === 'ALL') return 'all inbound'
        const verb = (RULE_TYPE_LABEL[c.ruleType] ?? c.ruleType).toLowerCase()
        const negated = c.negate ? `does NOT ${verb}` : verb
        const vals = c.values?.length ? ` "${c.values.slice(0, 2).join('", "')}${c.values.length > 2 ? '…' : ''}"` : ''
        return `${negated}${vals}`
      })
      return parts.join(' AND ')
    })
    return groupSummaries.join(' OR ')
  }
  if (rule.ruleType === 'ALL') return 'All inbound'
  return `${RULE_TYPE_LABEL[rule.ruleType] ?? rule.ruleType} ${rule.value ?? ''}`.trim()
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function TriggerOverviewPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const base = `/dashboard/${workspaceId}/agents/${agentId}`

  const [channels, setChannels] = useState<ChannelDeployment[] | null>(null)
  const [agent, setAgent] = useState<AgentDetails | null>(null)
  const [triggers, setTriggers] = useState<ContactTrigger[] | null>(null)

  useEffect(() => {
    // Parallel load — every sub-page reads from independent endpoints.
    // Detection rules used to surface here too; they moved to Skills →
    // Playbook so this page focuses on routing-time questions only.
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/channels`)
        .then(r => r.json())
        .then(d => setChannels(d.deployments ?? []))
        .catch(() => setChannels([])),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`)
        .then(r => r.json())
        .then(d => setAgent({
          isActive: !!d.agent?.isActive,
          workingHoursEnabled: !!d.agent?.workingHoursEnabled,
          workingHoursStart: d.agent?.workingHoursStart ?? null,
          workingHoursEnd: d.agent?.workingHoursEnd ?? null,
          workingDays: d.agent?.workingDays ?? null,
          timezone: d.agent?.timezone ?? null,
          routingRules: d.agent?.routingRules ?? [],
        }))
        .catch(() => setAgent(null)),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/triggers`)
        .then(r => r.json())
        .then(d => setTriggers(d.triggers ?? []))
        .catch(() => setTriggers([])),
    ])
  }, [workspaceId, agentId])

  const loading = channels === null || agent === null || triggers === null
  if (loading) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
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

  // ── Derived state ──────────────────────────────────────────────────────
  const activeChannels = channels!.filter(c => c.isActive)
  const inactiveChannels = ALL_CHANNELS.filter(k => !activeChannels.some(c => c.channel === k))
  const routingRules = agent!.routingRules
  const activeTriggers = triggers!.filter(t => t.isActive)

  // ── Top summary banner ────────────────────────────────────────────────
  // Reflects whether the agent will actually pick up an inbound right now.
  // Mirrors the listening pill on the agents list — same logic, same words.
  const isListening = agent!.isActive && activeChannels.length > 0 && routingRules.length > 0
  const banner = !agent!.isActive
    ? { tone: 'idle' as const,
        title: 'Agent is paused',
        body: 'No inbounds will be answered until you activate the agent (Pause/Activate button at the top of the page).' }
    : activeChannels.length === 0
    ? { tone: 'warn' as const,
        title: 'No channels enabled',
        body: 'The agent is active but isn\'t listening on any channel. Enable at least one channel below.' }
    : routingRules.length === 0
    ? { tone: 'warn' as const,
        title: 'No routing rules',
        body: 'The agent is active and has channels, but no routing rule. Inbounds will be skipped at the webhook pre-filter.' }
    : { tone: 'live' as const,
        title: `Listening on ${activeChannels.map(c => CHANNEL_LABELS[c.channel] ?? c.channel).join(', ')}`,
        body: 'When a contact messages on one of these channels and matches your routing rules, this agent will respond.' }

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
            banner.tone === 'live'
              ? { color: 'var(--accent-emerald)' }
              : banner.tone === 'warn'
              ? { color: 'var(--accent-amber)' }
              : { color: 'var(--text-secondary)' }
          }
        >
          {banner.title}
        </p>
        <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{banner.body}</p>
      </div>

      {/* Channels */}
      <OverviewSection
        title="Channels"
        pill={
          activeChannels.length > 0
            ? { tone: 'live', label: `${activeChannels.length} active` }
            : { tone: 'warn', label: 'None enabled' }
        }
        editHref={`${base}/deploy`}
      >
        {activeChannels.length === 0 ? (
          <EmptyHint>No channels enabled — inbounds won't reach this agent.</EmptyHint>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {activeChannels.map(c => (
              <Tag key={c.channel} tone="accent">{CHANNEL_LABELS[c.channel] ?? c.channel}</Tag>
            ))}
          </div>
        )}
        {inactiveChannels.length > 0 && (
          <p className="text-[11px] mt-3" style={{ color: 'var(--text-tertiary)' }}>
            Inactive: {inactiveChannels.map(k => CHANNEL_LABELS[k] ?? k).join(', ')}
          </p>
        )}
      </OverviewSection>

      {/* Routing rules */}
      <OverviewSection
        title="Routing rules"
        subtitle="Which inbound conversations this agent picks up. The agent only fires when an inbound matches one of these rules."
        pill={
          routingRules.length > 0
            ? { tone: 'live', label: `${routingRules.length} ${routingRules.length === 1 ? 'rule' : 'rules'}` }
            : { tone: 'warn', label: 'None' }
        }
        editHref={`${base}/routing`}
      >
        {routingRules.length === 0 ? (
          <EmptyHint>
            No routing rules — the webhook pre-filter will drop every inbound. Add at least one rule
            (e.g. "All inbound" if you want this agent to take everything).
          </EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {routingRules.slice(0, 4).map(r => (
              <li key={r.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                <span style={{ color: 'var(--text-tertiary)' }}>•</span> {summarizeRoutingRule(r)}
              </li>
            ))}
            {routingRules.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{routingRules.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>

      {/* Working hours */}
      <OverviewSection
        title="Working hours"
        subtitle="When the agent can proactively send messages (follow-ups, contact-event triggers). Inbound replies always go through immediately."
        pill={
          agent!.workingHoursEnabled
            ? { tone: 'info', label: 'On' }
            : { tone: 'idle', label: 'Off — sends 24/7' }
        }
        editHref={`${base}/working-hours`}
      >
        {agent!.workingHoursEnabled ? (
          <div className="space-y-1.5">
            <OverviewRow
              label="Schedule"
              value={`${fmtHour(agent!.workingHoursStart ?? 9)} – ${fmtHour(agent!.workingHoursEnd ?? 17)}`}
            />
            <OverviewRow
              label="Days"
              value={fmtDays(agent!.workingDays ?? [])}
            />
            <OverviewRow
              label="Timezone"
              value={agent!.timezone ?? 'America/New_York'}
            />
          </div>
        ) : (
          <EmptyHint>Working hours are off — the agent can send proactive messages at any time.</EmptyHint>
        )}
      </OverviewSection>

      {/* Proactive triggers */}
      <OverviewSection
        title="Proactive triggers"
        subtitle="Start a conversation when something happens in your CRM (new contact created, tag added) — the agent sends the first message."
        pill={
          activeTriggers.length > 0
            ? { tone: 'info', label: `${activeTriggers.length} active` }
            : { tone: 'idle', label: 'None' }
        }
        editHref={`${base}/triggers`}
      >
        {activeTriggers.length === 0 ? (
          <EmptyHint>No proactive triggers — this agent only responds to inbound messages.</EmptyHint>
        ) : (
          <ul className="space-y-1.5">
            {activeTriggers.slice(0, 4).map(t => {
              const event = t.eventType === 'ContactCreate'
                ? 'New contact'
                : `Tag "${t.tagFilter ?? 'any'}" added`
              const mode = t.messageMode === 'FIXED' ? 'fixed message' : 'AI generated'
              return (
                <li key={t.id} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-tertiary)' }}>•</span> {event}{' '}
                  <span style={{ color: 'var(--text-tertiary)' }}>→ {CHANNEL_LABELS[t.channel] ?? t.channel}, {mode}</span>
                </li>
              )
            })}
            {activeTriggers.length > 4 && (
              <li className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                +{activeTriggers.length - 4} more
              </li>
            )}
          </ul>
        )}
      </OverviewSection>
    </div>
  )
}
