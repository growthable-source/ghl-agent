'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon,
  GoHighLevelIcon,
} from '@/components/icons/brand-icons'
import { BUSINESS_CONTEXT_EXAMPLES } from '@/lib/business-context-examples'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'
import PlanLimitNotice, { isPlanLimitError, type PlanLimitData } from '@/components/PlanLimitNotice'

type Step = 'template' | 'crm' | 'calendar' | 'channels' | 'knowledge' | 'build'

const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Type' },
  { key: 'crm', label: 'CRM' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'channels', label: 'Channels' },
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'build', label: 'Build' },
]

interface AgentTemplate {
  id: string
  initiation: 'outbound' | 'inbound'
  role: 'sales' | 'support' | 'assistant' | 'live_chat'
  name: string
  tagline: string
  icon: string
  systemPrompt: string
  instructions: string
  enabledTools: string[]
  /**
   * Maps to a B2 preset (Conversational Bot / Booking Bot / Custom). Set
   * server-side at create time via /api/workspaces/[wsId]/agents
   * `presetId` body field. The preset's per-tool deltas (e.g. disable
   * commerce, set booking onFailure = transfer) layer on top of the
   * template's broader enabledTools / persona / prompt config.
   */
  defaultPresetId: 'booking' | 'conversational' | 'custom'
}

const TEMPLATES: AgentTemplate[] = [
  {
    id: 'outbound-sales',
    initiation: 'outbound',
    role: 'sales',
    name: 'Outbound Sales',
    tagline: 'Proactively reaches leads, qualifies them, and books meetings',
    icon: '🎯',
    systemPrompt: `You are an outbound sales agent. Your job is to proactively engage with leads who have expressed interest, qualify them with a series of questions, and move them toward booking an appointment or next step.

You initiate the conversation, guide it with purpose, and don't wait for the lead to take action — you lead them there.`,
    instructions: `- Always open by reminding the contact why you're reaching out (their inquiry, their opt-in, etc.)
- Use a friendly, confident, and concise tone — no long monologues
- Ask qualifying questions one at a time and listen before moving forward
- If the lead qualifies, push for the appointment booking
- If the lead isn't interested, tag them appropriately and close gracefully
- Never push more than twice on a specific ask`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'update_contact_tags', 'add_contact_note', 'get_available_slots', 'book_appointment', 'score_lead', 'transfer_to_human'],
    defaultPresetId: 'booking',
  },
  {
    id: 'outbound-support',
    initiation: 'outbound',
    role: 'support',
    name: 'Outbound Follow-up',
    tagline: 'Re-engages customers after service, collects feedback, resolves issues',
    icon: '🔄',
    systemPrompt: `You are an outbound customer follow-up agent. You reach out to customers after a service, purchase, or interaction to check in, gather feedback, and resolve any lingering issues.

You represent the business in a warm, professional way and make customers feel valued.`,
    instructions: `- Open by referencing the specific service or interaction
- Ask open-ended questions to learn how their experience was
- If they raise an issue, acknowledge it and take action (tag, note, escalate)
- If they're satisfied, thank them and optionally ask for a referral or review
- Keep messages short — customers don't expect long follow-up texts`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'update_contact_tags', 'add_contact_note', 'detect_sentiment', 'schedule_followup', 'transfer_to_human'],
    defaultPresetId: 'conversational',
  },
  {
    id: 'outbound-assistant',
    initiation: 'outbound',
    role: 'assistant',
    name: 'Outbound Assistant',
    tagline: 'Sends reminders, confirms appointments, handles scheduling outreach',
    icon: '📤',
    systemPrompt: `You are an outbound scheduling and reminder assistant. You proactively contact people to confirm upcoming appointments, remind them of deadlines or events, and assist with rescheduling when needed.

You are clear, direct, and action-oriented.`,
    instructions: `- Always state the reason for the outreach immediately
- Confirm specific details (date, time, location) and ask for confirmation
- If they need to reschedule, offer available alternatives
- Keep messages brief — one clear action per message
- Log all outcomes (confirmed, rescheduled, cancelled) to the contact record`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'get_calendar_events', 'get_available_slots', 'book_appointment', 'add_contact_note', 'schedule_followup'],
    defaultPresetId: 'booking',
  },
  {
    id: 'inbound-sales',
    initiation: 'inbound',
    role: 'sales',
    name: 'Inbound Sales',
    tagline: 'Responds to inbound leads, answers questions, converts to bookings',
    icon: '📥',
    systemPrompt: `You are an inbound sales agent. You respond to people who have reached out — via SMS, web chat, or form submission — and help them understand your service, answer their questions, and guide them toward booking an appointment.

You are responsive, knowledgeable, and helpful without being pushy.`,
    instructions: `- Respond promptly and warmly to whoever has reached out
- Answer questions clearly and honestly
- Naturally weave in qualifying questions to understand their needs
- When they seem ready, introduce the booking option
- If they're not ready yet, offer to follow up or send useful info
- Never pressure — let the conversation move at their pace`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'update_contact_tags', 'add_contact_note', 'get_available_slots', 'book_appointment', 'score_lead', 'transfer_to_human'],
    defaultPresetId: 'booking',
  },
  {
    id: 'inbound-support',
    initiation: 'inbound',
    role: 'support',
    name: 'Inbound Support',
    tagline: 'Handles customer questions, resolves issues, escalates when needed',
    icon: '🎧',
    systemPrompt: `You are an inbound customer support agent. You help customers who reach out with questions, problems, or requests. You resolve issues where you can, gather context when you can't, and escalate to a human when the situation calls for it.

You are empathetic, patient, and solution-focused.`,
    instructions: `- Greet the customer and acknowledge their concern immediately
- Ask clarifying questions to fully understand the issue before responding
- Provide clear, accurate answers — don't guess
- If you can't resolve it, let them know clearly and escalate to a human with full context
- Log the issue, outcome, and any tags to the contact record
- Always close with a confirmation that their issue has been addressed or next steps`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'update_contact_tags', 'add_contact_note', 'search_contacts', 'detect_sentiment', 'transfer_to_human'],
    defaultPresetId: 'conversational',
  },
  {
    id: 'inbound-assistant',
    initiation: 'inbound',
    role: 'assistant',
    name: 'Inbound Assistant',
    tagline: 'Books appointments, answers FAQs, and manages requests conversationally',
    icon: '🤝',
    systemPrompt: `You are a friendly inbound assistant. You help people who reach out with scheduling requests, general questions, and information needs. You make it easy to book, reschedule, or get answers without any friction.

You are warm, conversational, and efficient.`,
    instructions: `- Be conversational and friendly — this is a helpful assistant, not a salesperson
- Understand what they need before jumping to a solution
- For scheduling requests, check availability and book directly
- For questions, give accurate and concise answers
- If something is outside your scope, let them know and offer to connect them with someone who can help`,
    enabledTools: ['get_contact_details', 'send_reply', 'send_sms', 'get_available_slots', 'book_appointment', 'get_calendar_events', 'add_contact_note', 'transfer_to_human'],
    defaultPresetId: 'booking',
  },
  {
    id: 'inbound-live-chat',
    initiation: 'inbound',
    role: 'live_chat',
    name: 'Live Chat Concierge',
    tagline: 'Tuned for the on-site widget — short replies, fast handoff, closes the chat when done',
    icon: '💬',
    systemPrompt: `You are the live-chat concierge for this business. Visitors are talking to you from the chat widget on the company website — replies should feel like a quick human exchange, not an email.

Keep replies short (1-2 sentences). Be warm and concrete. Use plain text — no markdown headings or bullet lists; the widget renders them awkwardly. If you need multiple pieces of info, ask ONE question at a time and wait for the answer.`,
    instructions: `- Greet briefly and ask how you can help
- Use your knowledge base, products, and CRM tools to answer their question
- For returning customers with an order question, look them up before answering
- If they need a real person (asked for one, hostile, or you're stuck after one honest attempt), call transfer_to_human with a clear reason
- Before they leave, if you don't already have their email, ask: "What's the best email to reach you on if I need to follow up?" Save it with add_contact_note
- When the visitor signals they're done (thanks, goodbye, "that's all"), send one brief reply and THEN call end_conversation with a one-sentence summary
- Never invent product details, prices, or stock — use Shopify tools if available, otherwise say you'll check
- Never end the chat mid-question or while they might still need help`,
    enabledTools: ['get_contact_details', 'send_reply', 'find_contact_by_email_or_phone', 'add_contact_note', 'update_contact_memory', 'transfer_to_human', 'end_conversation', 'schedule_followup'],
    defaultPresetId: 'conversational',
  },
]

// Static descriptor — `connected` state is resolved per-workspace at
// render time from /api/workspaces/:id/integrations. The previous
// hardcoded `connected: true` meant every new user saw "Already connected
// via OAuth" the very first time they hit the wizard, before they'd ever
// clicked Connect.
// 'native' is the recommended default — workspaces auto-provision native
// on creation, so the wizard's "Native CRM" option is already active by
// the time the user sees this step. It still routes through the same
// switch/provision endpoint when they explicitly pick it (idempotent),
// which covers the older workspaces created before auto-provision shipped.
const CRM_OPTIONS = [
  { id: 'native', name: 'Native CRM', desc: 'Built-in contacts, lists, SMS & email — recommended for new workspaces', icon: '📇' as const },
  { id: 'ghl', name: 'LeadConnector', icon: <GoHighLevelIcon className="w-8 h-8" /> },
]

const CALENDAR_OPTIONS = [
  { id: 'ghl', name: 'LeadConnector Calendar', desc: 'Use your LeadConnector calendar', icon: <GoHighLevelIcon className="w-8 h-8" /> },
  { id: 'none', name: 'No Calendar', desc: 'Skip — agent won\'t book appointments', icon: null },
]

const CHANNEL_OPTIONS = [
  { key: 'SMS', label: 'SMS', desc: 'Text messages', icon: <SmsIcon className="w-5 h-5" />, color: 'text-blue-400' },
  { key: 'WhatsApp', label: 'WhatsApp', desc: 'WhatsApp Business', icon: <WhatsAppIcon className="w-5 h-5" />, color: 'text-[#25D366]' },
  { key: 'FB', label: 'Facebook Messenger', desc: 'Facebook page messages', icon: <FacebookIcon className="w-5 h-5" />, color: 'text-[#1877F2]' },
  { key: 'IG', label: 'Instagram DMs', desc: 'Instagram direct messages', icon: <InstagramIcon className="w-5 h-5" />, color: 'text-[#E4405F]' },
  { key: 'GMB', label: 'Google Business', desc: 'Google Business messages', icon: <GoogleIcon className="w-5 h-5" />, color: 'text-white' },
  { key: 'Live_Chat', label: 'Live Chat', desc: 'Website chat widget', icon: <LiveChatIcon className="w-5 h-5" />, color: 'text-violet-400' },
  { key: 'Email', label: 'Email', desc: 'Email conversations', icon: <EmailIcon className="w-5 h-5" />, color: 'text-amber-400' },
]

const INITIATION_LABELS: Record<string, string> = { outbound: 'Outbound', inbound: 'Inbound' }
const ROLE_LABELS: Record<string, string> = { sales: 'Sales', support: 'Support', assistant: 'Assistant', live_chat: 'Live Chat' }

export default function NewAgentWizard() {
  const router = useRouter()
  const params = useParams()
  const search = useSearchParams()
  const workspaceId = params.workspaceId as string

  // Initial step honours ?step=… so the wizard can be deep-linked
  // (e.g. the OAuth callback returns the user here after they connect
  // LeadConnector mid-wizard — landing them back on the CRM step
  // instead of step 1).
  const stepFromUrl = (() => {
    const raw = search.get('step')
    const valid: Step[] = ['template', 'crm', 'calendar', 'channels', 'knowledge', 'build']
    return (valid as readonly string[]).includes(raw ?? '') ? (raw as Step) : 'template'
  })()
  const [step, setStep] = useState<Step>(stepFromUrl)
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null)
  // Default to 'native' — workspace creation auto-provisions native, so
  // every new workspace lands here with the native CRM already active.
  // Users who connect LeadConnector switch by clicking the GHL card,
  // which fires the workspace-level provider switch on Continue.
  const [selectedCrm, setSelectedCrm] = useState<string>('native')
  const [selectedCalendar, setSelectedCalendar] = useState<string>('none')
  // The specific calendarId picked from the LeadConnector calendar list.
  // Without this the new agent is created with calendarProvider='ghl' but
  // no calendarId, leaving the user to hunt for it on the /tools page
  // before any booking tool actually works. Empty string = "I picked
  // LeadConnector but haven't selected a calendar yet".
  const [selectedCalendarId, setSelectedCalendarId] = useState<string>('')
  const [ghlCalendars, setGhlCalendars] = useState<Array<{ id: string; name: string }>>([])
  const [ghlCalendarsLoading, setGhlCalendarsLoading] = useState(false)
  const [ghlCalendarsError, setGhlCalendarsError] = useState<string | null>(null)
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['SMS'])

  // Auto-load the calendar list whenever the user picks LeadConnector.
  // Switching back to 'none' clears the picked id so it doesn't get
  // submitted with a stale calendarId from a prior selection.
  useEffect(() => {
    if (selectedCalendar !== 'ghl') {
      setSelectedCalendarId('')
      return
    }
    setGhlCalendarsLoading(true)
    setGhlCalendarsError(null)
    fetch(`/api/workspaces/${workspaceId}/calendars`)
      .then(async r => {
        if (!r.ok) {
          const body = await r.text().catch(() => '')
          throw new Error(body || `Failed to load calendars (${r.status})`)
        }
        return r.json()
      })
      .then(d => {
        const list: Array<{ id: string; name: string }> = (d.calendars ?? [])
          .map((c: any) => ({ id: c.id, name: c.name ?? c.id }))
        setGhlCalendars(list)
        // Auto-pick if there's exactly one calendar — saves a click and
        // matches the "your agent ships ready to book" goal.
        if (list.length === 1) setSelectedCalendarId(list[0].id)
      })
      .catch(err => setGhlCalendarsError(err?.message ?? 'Failed to load calendars'))
      .finally(() => setGhlCalendarsLoading(false))
  }, [selectedCalendar, workspaceId])

  // Knowledge step — which indexed collections the new agent reads
  // from. null = "all" (workspace-wide, backward-compatible default).
  // A string[] = explicit pick. Loaded from the workspace's
  // knowledge-domains endpoint when the wizard mounts.
  const [knowledgeDomains, setKnowledgeDomains] = useState<Array<{ id: string; name: string; description: string | null; chunkCount: number }>>([])
  const [knowledgePick, setKnowledgePick] = useState<string[] | null>(null)
  useEffect(() => {
    fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => setKnowledgeDomains(d.domains ?? []))
      .catch(() => {})
  }, [workspaceId])

  // Real provider state. ghlConnected drives the LeadConnector card's
  // Connect button; nativeProvisioned tells us whether the workspace's
  // current CRM is native (so we can show "Active ✓" up front).
  const [ghlConnected, setGhlConnected] = useState<boolean | null>(null)
  const [currentCrm, setCurrentCrm] = useState<string | null>(null)
  // installSource tells us whether this workspace came in via a
  // marketplace install (LeadConnector / Shopify / HubSpot). When it
  // did, the CRM step of the wizard is meaningless — their CRM is
  // already chosen and connected. We drop the step entirely below.
  const [installSource, setInstallSource] = useState<string | null>(null)
  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/integrations`)
      .then(r => r.json())
      .then(d => {
        setGhlConnected(!!d.ghlConnected)
        setCurrentCrm(d.crmProvider ?? null)
        setInstallSource(d.installSource ?? null)
        // Initial selection priority:
        //   1. workspace.primaryCrmProvider when the matching CRM is
        //      actually connected (avoids defaulting to 'ghl' before
        //      OAuth completes on a fresh marketplace install).
        //   2. Marketplace installs: force 'ghl' if GHL is connected,
        //      regardless of what primaryCrmProvider reads (covers
        //      un-migrated DBs where primary returns its 'native'
        //      default but the workspace actually came from the
        //      LeadConnector marketplace).
        //   3. Legacy fallback on d.crmProvider when primary isn't set.
        const primary: string | undefined = d.primaryCrmProvider
        const available = d.availableCrms ?? {}
        if (d.installSource === 'ghl_marketplace' && d.ghlConnected) {
          setSelectedCrm('ghl')
        } else if (primary === 'native' && available.native !== false) setSelectedCrm('native')
        else if (primary === 'ghl' && (available.ghl || d.ghlConnected)) setSelectedCrm('ghl')
        else if (primary === 'hubspot' && available.hubspot) setSelectedCrm('hubspot')
        else if (d.crmProvider === 'native') setSelectedCrm('native')
        else if (d.crmProvider === 'ghl' && d.ghlConnected) setSelectedCrm('ghl')
      })
      .catch(() => setGhlConnected(false))
  }, [workspaceId])

  // Drop the 'crm' step from the wizard when the CRM choice has been
  // implicitly made for the user — marketplace installs imply that
  // CRM. ghlConnected as a gate so that a misconfigured install
  // (workspace marked as marketplace but no GHL token yet) doesn't
  // strand the user with no way to pick a CRM.
  const skipCrmStep =
    installSource === 'ghl_marketplace' && ghlConnected === true
  const visibleSteps = useMemo(
    () => STEPS.filter(s => s.key !== 'crm' || !skipCrmStep),
    [skipCrmStep],
  )

  // Build step
  const [name, setName] = useState('')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [instructions, setInstructions] = useState('')
  // Advanced-context agent profile — Simple is the default and matches the
  // long-standing behaviour; Advanced additionally pre-loads the contact's
  // opportunities (last ~6 months) and custom fields into every turn's
  // system prompt, plus a free-text businessContext glossary the operator
  // fills out here so the LLM knows what its data means.
  const [agentType, setAgentType] = useState<'SIMPLE' | 'ADVANCED'>('SIMPLE')
  const [businessContext, setBusinessContext] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [planLimit, setPlanLimit] = useState<PlanLimitData | null>(null)
  // Track whether the user has hand-edited the name. Template changes only
  // overwrite the name while it's still template-derived — otherwise we'd
  // clobber a name the user typed. Previously this used `if (!name)` which
  // locked the name to whatever template was picked FIRST, even if the user
  // later switched templates (e.g. Outbound → Inbound Assistant stuck as
  // "Outbound Assistant Agent").
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)

  const currentIdx = visibleSteps.findIndex(s => s.key === step)

  // If the wizard initialised on the 'crm' step (the legacy default
  // before this branch loaded) but `skipCrmStep` evaluates true, advance
  // past it as soon as the install-source data arrives. Otherwise the
  // user gets stuck with currentIdx=-1 and no Continue button.
  useEffect(() => {
    if (skipCrmStep && step === 'crm') {
      setStep('calendar')
    }
  }, [skipCrmStep, step])

  async function next() {
    // Leaving the CRM step: persist the selection at the workspace level
    // so the agent's locationId resolves to the right Location row, the
    // sidebar's Native CRM section appears, and the runtime adapter
    // factory routes correctly. Idempotent — safe to re-fire.
    if (step === 'crm' && currentCrm !== selectedCrm) {
      // fetch() only rejects on network error — a non-2xx response
      // (plan limit, schema mid-migration, server bug) resolves
      // normally. We have to inspect res.ok or the previous silent-
      // swallow lets the wizard advance with the CRM unchanged, and
      // the agent created at the end FKs to the wrong Location.
      try {
        if (selectedCrm === 'native') {
          const prov = await fetch(`/api/workspaces/${workspaceId}/crm/native/provision`, { method: 'POST' })
          if (!prov.ok) {
            const detail = await prov.json().catch(() => ({}))
            setError(detail.error || `Failed to provision Native CRM (${prov.status})`)
            return
          }
        }
        const patch = await fetch(`/api/workspaces/${workspaceId}/integrations`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crmProvider: selectedCrm }),
        })
        if (!patch.ok) {
          const detail = await patch.json().catch(() => ({}))
          setError(detail.error || `Failed to switch CRM (${patch.status})`)
          return
        }
        setCurrentCrm(selectedCrm)
        setError('')
      } catch (err: any) {
        console.error('[agent-wizard] CRM switch network error:', err)
        setError(err?.message ?? 'Network error switching CRM. Try again.')
        return
      }
    }
    const nextIdx = currentIdx + 1
    if (nextIdx < visibleSteps.length) setStep(visibleSteps[nextIdx].key)
  }

  function back() {
    const prevIdx = currentIdx - 1
    if (prevIdx >= 0) setStep(visibleSteps[prevIdx].key)
  }

  function selectTemplate(t: AgentTemplate) {
    setSelectedTemplate(t)
    // Update the name to match the new template unless the user has typed
    // their own name. System prompt and instructions always follow the
    // template — those are expected to reset on template change.
    if (!nameManuallyEdited) setName(t.name + ' Agent')
    setSystemPrompt(t.systemPrompt)
    setInstructions(t.instructions)
    // Live Chat is channel-specific — preselect Live_Chat so the
    // operator doesn't have to remember to flip it on the Channels
    // step (and so SMS isn't left ticked by default for a chat-only
    // agent). The user can still change channels manually.
    if (t.role === 'live_chat') {
      setSelectedChannels(['Live_Chat'])
    }
  }

  function toggleChannel(key: string) {
    setSelectedChannels(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    )
  }

  async function handleCreate() {
    if (!name.trim() || !systemPrompt.trim()) return
    setSaving(true)
    setError('')
    setPlanLimit(null)

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          systemPrompt,
          instructions,
          crmProvider: selectedCrm,
          calendarProvider: selectedCalendar,
          agentType,
          ...(agentType === 'ADVANCED' && businessContext.trim() && { businessContext }),
          ...(selectedTemplate && { enabledTools: selectedTemplate.enabledTools }),
          // Calendar wiring at create time: send the picked calendarId
          // so the agent ships ready-to-book. Without this the agent
          // would need a manual trip to /tools to wire up the calendar.
          ...(selectedCalendar === 'ghl' && selectedCalendarId && {
            calendarId: selectedCalendarId,
          }),
          // B2 preset mapping is now driven by the CALENDAR CHOICE, not
          // the template archetype. The mental model: "Did you wire up a
          // calendar?" → booking bot. "Skipped calendar?" → conversational.
          // Template only contributes the persona/prompt + base tool list;
          // the preset adds the per-tool deltas (commerce off, etc).
          // Falls back to the template's default if no clear calendar
          // signal (shouldn't happen in practice — the Calendar step is
          // mandatory).
          presetId:
            selectedCalendar === 'ghl' && selectedCalendarId
              ? 'booking'
              : selectedCalendar === 'none'
                ? 'conversational'
                : selectedTemplate?.defaultPresetId ?? 'custom',
          // Knowledge scope. Null/undefined = read from every domain
          // in the workspace (backward-compatible). An explicit
          // array narrows. Empty array would mean "none" which
          // we never want from the wizard.
          ...(knowledgePick !== null && knowledgePick.length > 0 && {
            knowledgeDomainIds: knowledgePick,
          }),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (isPlanLimitError(data)) {
          setPlanLimit(data)
          setSaving(false)
          return
        }
        throw new Error(data.error || `Failed to create agent (${res.status})`)
      }

      // Save channel deployments. If this fails (network blip, plan
      // limit, schema drift) we previously navigated anyway and the
      // agent landed on the deploy page with zero channels active —
      // silently broken. Surface a banner but still navigate so the
      // user can manually enable channels from the deploy page.
      let channelWarning: string | null = null
      if (selectedChannels.length > 0) {
        try {
          const chRes = await fetch(`/api/workspaces/${workspaceId}/agents/${data.agent.id}/channels`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              channels: selectedChannels.map(ch => ({ channel: ch, isActive: true })),
            }),
          })
          if (!chRes.ok) {
            const detail = await chRes.json().catch(() => ({}))
            channelWarning = detail.error || `Couldn't enable channels (${chRes.status})`
            console.error('[agent-wizard] channel deployment failed', { agentId: data.agent.id, status: chRes.status, detail })
          }
        } catch (err: any) {
          channelWarning = err?.message ?? 'Channel deployment network error'
          console.error('[agent-wizard] channel deployment threw', err)
        }
      }

      const dest = `/dashboard/${workspaceId}/agents/${data.agent.id}/deploy`
      router.push(channelWarning ? `${dest}?warning=${encodeURIComponent(channelWarning)}` : dest)
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  // Per-step gating. The calendar step blocks Continue when the user
  // picked LeadConnector but hasn't actually selected a specific
  // calendar from the list (or while the list is still loading).
  // Without this gate the agent ships with calendarProvider='ghl' and
  // calendarId=null, which is exactly the configuration that caused
  // the silent-failure incident — the agent would try to fetch slots
  // for an empty calendarId and 404.
  const canProceed = (() => {
    if (step === 'template') return selectedTemplate !== null
    if (step === 'calendar') {
      if (selectedCalendar === 'ghl') {
        return selectedCalendarId !== '' && !ghlCalendarsLoading
      }
      // 'none' (or anything else) — no calendar required to advance.
      return true
    }
    return true
  })()
  const canCreate = name.trim() && systemPrompt.trim()

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {visibleSteps.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors"
                  style={
                    i < currentIdx
                      ? { background: 'var(--accent-emerald)', color: '#fff' }
                      : i === currentIdx
                      ? { background: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                      : { background: 'var(--surface-tertiary)', color: 'var(--text-muted)' }
                  }
                >
                  {i < currentIdx ? '✓' : i + 1}
                </div>
                <span
                  className="text-xs font-medium hidden sm:block"
                  style={{
                    color: i <= currentIdx ? 'var(--text-primary)' : 'var(--text-muted)',
                  }}
                >{s.label}</span>
              </div>
              {i < visibleSteps.length - 1 && (
                <div
                  className="h-px flex-1 mx-2"
                  style={{
                    background: i < currentIdx ? 'var(--accent-emerald)' : 'var(--border)',
                  }}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step: Template */}
        {step === 'template' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">What kind of agent?</h1>
            <p className="text-zinc-400 text-sm mb-6">
              Pick the template that best fits your use case. Everything can be customized afterward.
            </p>

            <Link
              href={`/dashboard/${workspaceId}/agents/new/wizard`}
              className="block mb-6 p-5 rounded-xl border-2 border-orange-500/40 bg-gradient-to-br from-orange-500/10 to-orange-500/5 hover:border-orange-500/60 transition-colors"
            >
              <div className="flex items-start gap-4">
                <div className="text-3xl">✨</div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-white">Build with AI</p>
                  <p className="text-[12px] text-zinc-300 mt-0.5">
                    Skip the templates. Describe what you want in plain English and I&apos;ll generate the system prompt,
                    rules, qualifying questions, and tools for you.
                  </p>
                </div>
                <span className="text-xs text-orange-300 font-semibold whitespace-nowrap">Try it →</span>
              </div>
            </Link>

            {/* Outbound */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Outbound — Agent initiates the conversation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEMPLATES.filter(t => t.initiation === 'outbound').map(t => (
                  <button key={t.id} type="button" onClick={() => selectTemplate(t)}
                    className="flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors"
                    style={
                      selectedTemplate?.id === t.id
                        ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }>
                    <span className="text-2xl">{t.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{ROLE_LABELS[t.role]}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{t.tagline}</p>
                    </div>
                    {selectedTemplate?.id === t.id && (
                      <span className="text-xs text-emerald-400 font-medium">Selected</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Inbound */}
            <div>
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Inbound — Contact initiates the conversation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEMPLATES.filter(t => t.initiation === 'inbound').map(t => (
                  <button key={t.id} type="button" onClick={() => selectTemplate(t)}
                    className="flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors"
                    style={
                      selectedTemplate?.id === t.id
                        ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }>
                    <span className="text-2xl">{t.icon}</span>
                    <div>
                      <p className="text-sm font-medium text-zinc-200">{ROLE_LABELS[t.role]}</p>
                      <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">{t.tagline}</p>
                    </div>
                    {selectedTemplate?.id === t.id && (
                      <span className="text-xs text-emerald-400 font-medium">Selected</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Step: CRM */}
        {step === 'crm' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Pick your CRM</h1>
            <p className="text-zinc-400 text-sm mb-6">
              Native is the built-in option — contacts, lists, SMS &amp; email all included. Already active for new workspaces, so you can keep moving. LeadConnector is for teams that already have one.
            </p>
            <div className="space-y-3">
              {CRM_OPTIONS.map(opt => {
                const isGhl = opt.id === 'ghl'
                const isNative = opt.id === 'native'
                const isConnected = isGhl && ghlConnected === true
                const isChecking = isGhl && ghlConnected === null
                const isActiveNow = (isNative && currentCrm === 'native') || (isGhl && currentCrm === 'ghl' && isConnected)

                const desc = isGhl
                  ? (isChecking ? 'Checking…' : isConnected ? 'Connected via OAuth' : 'Not connected yet — click Connect below')
                  : (opt as any).desc
                return (
                  <div key={opt.id}>
                    <button type="button" onClick={() => setSelectedCrm(opt.id)}
                      className="w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors"
                      style={
                        selectedCrm === opt.id
                          ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                          : { borderColor: 'var(--border)', background: 'var(--surface)' }
                      }>
                      <span className="w-8 h-8 flex items-center justify-center flex-shrink-0 text-2xl">
                        {typeof opt.icon === 'string'
                          ? opt.icon
                          : (opt.icon || <span style={{ color: 'var(--text-muted)' }}>--</span>)}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.name}</p>
                        <p className="text-xs" style={{ color: isGhl && !isConnected && !isChecking ? 'var(--accent-amber)' : 'var(--text-tertiary)' }}>{desc}</p>
                      </div>
                      {isActiveNow && (
                        <span
                          className="text-xs font-semibold mr-2 px-2 py-0.5 rounded-full"
                          style={{ background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }}
                        >
                          Active
                        </span>
                      )}
                      {selectedCrm === opt.id && (
                        <span
                          className="w-5 h-5 rounded-full flex items-center justify-center"
                          style={{ background: 'var(--btn-primary-bg)' }}
                        >
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: 'var(--btn-primary-text)' }}
                          />
                        </span>
                      )}
                    </button>

                    {/* Inline connect CTA when GHL is selected but not connected.
                        The returnTo param tells the OAuth callback to bring the
                        user back to the wizard (and the CRM step specifically)
                        after the round-trip — otherwise they'd land on the
                        workspace integrations page and have to restart the
                        wizard from step 1. */}
                    {isGhl && selectedCrm === 'ghl' && ghlConnected === false && (
                      <a
                        href={`/api/auth/crm/connect?workspaceId=${workspaceId}&returnTo=${encodeURIComponent(`/dashboard/${workspaceId}/agents/new?step=crm`)}`}
                        className="mt-2 inline-flex items-center rounded-lg font-medium text-sm px-4 h-9 hover:opacity-90 transition-colors"
                        style={{
                          background: 'var(--btn-primary-bg)',
                          color: 'var(--btn-primary-text)',
                        }}
                      >
                        Connect LeadConnector →
                      </a>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Step: Calendar */}
        {step === 'calendar' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Connect a calendar</h1>
            <p className="text-zinc-400 text-sm mb-6">
              Picking a calendar wires the agent up for booking. Choose <em>No Calendar</em>{' '}
              and the agent will answer questions but won&apos;t schedule.
            </p>
            <div className="space-y-3">
              {CALENDAR_OPTIONS.map(opt => (
                <button key={opt.id} type="button" onClick={() => setSelectedCalendar(opt.id)}
                  className="w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors"
                  style={
                    selectedCalendar === opt.id
                      ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                      : { borderColor: 'var(--border)', background: 'var(--surface)' }
                  }>
                  <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">{opt.icon || <span className="text-2xl" style={{ color: 'var(--text-muted)' }}>--</span>}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{opt.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{opt.desc}</p>
                  </div>
                  {selectedCalendar === opt.id && (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: 'var(--btn-primary-bg)' }}
                    >
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: 'var(--btn-primary-text)' }}
                      />
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Sub-picker: actual calendarId selection when LeadConnector chosen. */}
            {selectedCalendar === 'ghl' && (
              <div
                className="mt-4 rounded-xl border p-4"
                style={{ borderColor: 'var(--border)', background: 'var(--surface-secondary)' }}
              >
                <p className="text-sm font-medium mb-3" style={{ color: 'var(--text-primary)' }}>
                  Which calendar should the agent book into?
                </p>
                {ghlCalendarsLoading && (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Loading your calendars…</p>
                )}
                {ghlCalendarsError && (
                  <p className="text-xs" style={{ color: 'var(--accent-red, #ef4444)' }}>
                    Couldn&apos;t load calendars: {ghlCalendarsError}
                  </p>
                )}
                {!ghlCalendarsLoading && !ghlCalendarsError && ghlCalendars.length === 0 && (
                  <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                    No calendars found in your CRM. Create one in LeadConnector, then come back — or pick <em>No Calendar</em> to ship a conversational-only agent.
                  </p>
                )}
                {!ghlCalendarsLoading && !ghlCalendarsError && ghlCalendars.length > 0 && (
                  <div className="space-y-2">
                    {ghlCalendars.map(cal => (
                      <button
                        key={cal.id}
                        type="button"
                        onClick={() => setSelectedCalendarId(cal.id)}
                        className="w-full flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors"
                        style={
                          selectedCalendarId === cal.id
                            ? { borderColor: 'var(--accent-primary)', background: 'var(--surface)' }
                            : { borderColor: 'var(--border)', background: 'transparent' }
                        }
                      >
                        <span
                          className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{
                            border: '1px solid var(--border)',
                            background: selectedCalendarId === cal.id ? 'var(--btn-primary-bg)' : 'transparent',
                          }}
                        >
                          {selectedCalendarId === cal.id && (
                            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--btn-primary-text)' }} />
                          )}
                        </span>
                        <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{cal.name}</span>
                        <code className="text-[10px] font-mono" style={{ color: 'var(--text-tertiary)' }}>{cal.id.slice(-8)}</code>
                      </button>
                    ))}
                  </div>
                )}
                {!ghlCalendarsLoading && selectedCalendarId === '' && ghlCalendars.length > 0 && (
                  <p className="text-xs mt-3" style={{ color: 'var(--text-tertiary)' }}>
                    Pick one to continue. The agent will only book into the calendar you select here.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step: Channels */}
        {step === 'channels' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Deploy to channels</h1>
            <p className="text-zinc-400 text-sm mb-6">
              Choose where this agent should respond. You can enable more channels later from the Deploy tab.
            </p>
            <div className="space-y-2.5">
              {CHANNEL_OPTIONS.map(ch => {
                const active = selectedChannels.includes(ch.key)
                return (
                  <button key={ch.key} type="button" onClick={() => toggleChannel(ch.key)}
                    className="w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors"
                    style={
                      active
                        ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }>
                    <span className={`w-8 flex items-center justify-center ${active ? ch.color : ''}`} style={!active ? { color: 'var(--text-tertiary)' } : undefined}>{ch.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium" style={{ color: active ? 'var(--text-primary)' : 'var(--text-secondary)' }}>{ch.label}</p>
                      <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>{ch.desc}</p>
                    </div>
                    <div
                      className="relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors"
                      style={{
                        background: active ? 'var(--accent-emerald)' : 'var(--surface-tertiary)',
                      }}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full shadow transition-transform ${
                          active ? 'translate-x-4' : 'translate-x-0'
                        }`}
                        style={{ background: '#fff' }}
                      />
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs text-zinc-500">
                <span className="text-zinc-400 font-medium">Voice calls</span> are configured separately after creation, from the Voice tab.
              </p>
            </div>
          </div>
        )}

        {/* Step: Knowledge */}
        {step === 'knowledge' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Pick what this agent knows</h1>
            <p className="text-sm text-zinc-400 mb-6">
              These are the indexed collections your AI reads from when answering. By default a new agent reads from <strong>all</strong> of them — narrow only if you need this agent to ignore certain content.
            </p>

            {knowledgeDomains.length === 0 ? (
              <div className="rounded-2xl border p-8 text-center" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
                <div className="text-3xl mb-2">📚</div>
                <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-primary)' }}>
                  No knowledge collections yet
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-tertiary)' }}>
                  Your agent will work without one, but it&apos;ll only know what you put in its system prompt. Add a collection any time from <strong>Knowledge → Sources &amp; ingestion</strong>.
                </p>
              </div>
            ) : (
              <>
                <div className="mb-3 flex items-center gap-3">
                  <button
                    onClick={() => setKnowledgePick(null)}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                    style={knowledgePick === null
                      ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)', borderColor: 'var(--accent-emerald)' }
                      : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                  >
                    Use all ({knowledgeDomains.length})
                  </button>
                  <button
                    onClick={() => setKnowledgePick([])}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors"
                    style={knowledgePick !== null
                      ? { background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' }
                      : { background: 'var(--surface)', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }}
                  >
                    Pick specific ones…
                  </button>
                </div>

                {knowledgePick !== null && (
                  <div className="space-y-2">
                    {knowledgeDomains.map(d => {
                      const checked = knowledgePick.includes(d.id)
                      return (
                        <label
                          key={d.id}
                          className="flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                          style={checked
                            ? { border: '1px solid var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                            : { border: '1px solid var(--border)', background: 'var(--surface)' }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setKnowledgePick(prev =>
                              prev === null ? [d.id]
                              : prev.includes(d.id) ? prev.filter(x => x !== d.id)
                              : [...prev, d.id]
                            )}
                            className="mt-1 accent-orange-500"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{d.name}</p>
                            {d.description && (
                              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-tertiary)' }}>{d.description}</p>
                            )}
                            <p className="text-[10px] mt-1" style={{ color: 'var(--text-tertiary)' }}>
                              {d.chunkCount} indexed entries
                            </p>
                          </div>
                        </label>
                      )
                    })}
                    {knowledgePick.length === 0 && (
                      <p className="text-[11px] mt-2" style={{ color: 'var(--accent-amber)' }}>
                        Tick at least one — or click &ldquo;Use all&rdquo; above. We&apos;ll default to all if you continue with none selected.
                      </p>
                    )}
                  </div>
                )}

                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-xs text-zinc-500">
                    You can change this any time from the agent&apos;s <span className="text-zinc-400 font-medium">Knowledge</span> tab.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* Step: Build */}
        {step === 'build' && (
          <div>
            <h1 className="text-2xl font-semibold mb-2">Review and build</h1>
            {selectedTemplate && (
              <div className="flex items-center gap-2 mb-5 text-sm text-zinc-400">
                <span className="text-base">{selectedTemplate.icon}</span>
                <span>{INITIATION_LABELS[selectedTemplate.initiation]} {ROLE_LABELS[selectedTemplate.role]} template</span>
                <span className="text-zinc-700">·</span>
                <span>{selectedChannels.length} channel{selectedChannels.length !== 1 ? 's' : ''}</span>
              </div>
            )}
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>Agent Name</label>
                <input type="text" value={name}
                  onChange={e => { setName(e.target.value); setNameManuallyEdited(true) }}
                  placeholder="e.g. Sales Assistant"
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--input-text)',
                  }} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>System Prompt</label>
                <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>The core identity and role of the agent. Pre-filled from your template — edit as needed.</p>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful sales assistant for Acme Corp..."
                  rows={7}
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none resize-y"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--input-text)',
                  }} />
              </div>
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Behavioral Instructions <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>Bullet-point rules the agent follows. Pre-filled from your template — edit as needed.</p>
                <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                  placeholder="- Always greet by first name&#10;- If they ask about pricing, send them the booking link"
                  rows={5}
                  className="w-full rounded-lg px-4 py-2.5 text-sm focus:outline-none resize-y"
                  style={{
                    background: 'var(--input-bg)',
                    border: '1px solid var(--input-border)',
                    color: 'var(--input-text)',
                  }} />
              </div>

              {/* ── Context level picker ──
                  SIMPLE is the default and zero-overhead. ADVANCED pre-loads
                  the contact's recent opportunities + custom fields into the
                  system prompt so the agent can reason about commercial
                  context (ex: a car dealer's vehicle inquiries) without
                  calling tools. Costs more tokens per turn but produces a
                  much richer conversation for data-heavy domains. */}
              <div>
                <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                  Context Level
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAgentType('SIMPLE')}
                    className="text-left rounded-lg border p-3 transition-colors"
                    style={
                      agentType === 'SIMPLE'
                        ? { borderColor: 'var(--accent-primary)', background: 'var(--surface-secondary)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }
                  >
                    <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Simple</p>
                    <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                      Name, tags, and conversation history only. Best for support bots, FAQ agents, and high-volume low-context use cases.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentType('ADVANCED')}
                    className="text-left rounded-lg border p-3 transition-colors"
                    style={
                      agentType === 'ADVANCED'
                        ? { borderColor: 'var(--accent-emerald)', background: 'var(--accent-emerald-bg)' }
                        : { borderColor: 'var(--border)', background: 'var(--surface)' }
                    }
                  >
                    <p className="text-sm font-medium flex items-center gap-1.5" style={{ color: 'var(--text-primary)' }}>
                      Advanced
                      <span
                        className="text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5"
                        style={{
                          color: 'var(--accent-emerald)',
                          background: 'var(--accent-emerald-bg)',
                          border: '1px solid var(--accent-emerald)',
                        }}
                      >
                        context
                      </span>
                    </p>
                    <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--text-tertiary)' }}>
                      Also loads the contact's opportunities (last ~6 months) and custom fields. Best for sales agents that need to reason about deals, products, or pricing.
                    </p>
                  </button>
                </div>
              </div>

              {agentType === 'ADVANCED' && (
                <div>
                  <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Business Context <span style={{ color: 'var(--text-muted)' }}>(optional)</span>
                  </label>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-tertiary)' }}>
                    Plain-English explanation of what your custom fields and opportunities represent. The agent reads this alongside the live data so it knows how to interpret what it&apos;s seeing. Merge fields like <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{'{{contact.first_name|there}}'}</span> and <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{'{{user.name|our team}}'}</span> resolve per-contact at runtime.
                  </p>

                  {/* Starter templates — operators told us a placeholder
                      alone doesn't register as "actual content." Explicit
                      pickers that write into the textarea fix that. */}
                  <div
                    className="rounded-lg p-3 mb-2"
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                      Start from an example
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {BUSINESS_CONTEXT_EXAMPLES.map(ex => (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => setBusinessContext(ex.body)}
                          className="text-xs rounded-full px-3 py-1 transition-colors"
                          style={{
                            color: 'var(--text-secondary)',
                            background: 'var(--surface-secondary)',
                            border: '1px solid var(--border)',
                          }}
                          title={ex.description}
                        >
                          {ex.label}
                        </button>
                      ))}
                      {businessContext.trim() && (
                        <button
                          type="button"
                          onClick={() => setBusinessContext('')}
                          className="text-xs transition-colors px-2"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  {/* MergeFieldTextarea adds the {{…}} Insert value picker
                      in the top-right corner. Tokens picked here (or typed
                      by hand) get rendered against the live contact + user
                      at runtime via renderMergeFields. Extra top padding
                      (pt-10) so the first line of content doesn't run
                      under the picker button. */}
                  <MergeFieldTextarea
                    value={businessContext}
                    onChange={e => setBusinessContext(e.target.value)}
                    onValueChange={setBusinessContext}
                    placeholder="Write your own or pick an example above…"
                    rows={10}
                    className="w-full rounded-lg px-4 pt-10 pb-2.5 text-sm focus:outline-none resize-y"
                    style={{
                      background: 'var(--input-bg)',
                      border: '1px solid var(--input-border)',
                      color: 'var(--input-text)',
                    }}
                  />
                </div>
              )}

              {/* Channel summary */}
              {selectedChannels.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">Deploying to</label>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedChannels.map(ch => {
                      const opt = CHANNEL_OPTIONS.find(o => o.key === ch)
                      return (
                        <span key={ch} className={`inline-flex items-center gap-1.5 bg-zinc-800 text-zinc-300 text-xs rounded-full px-2.5 py-1 ${opt?.color || ''}`}>
                          <span className="w-3.5 h-3.5">{opt?.icon}</span> {opt?.label}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )}

              {planLimit && (
                <PlanLimitNotice workspaceId={workspaceId} data={planLimit} />
              )}
              {error && !planLimit && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t" style={{ borderColor: 'var(--border)' }}>
          <div>
            {currentIdx > 0 ? (
              <button type="button" onClick={back}
                className="text-sm transition-colors flex items-center gap-1"
                style={{ color: 'var(--text-secondary)' }}>
                &larr; Back
              </button>
            ) : (
              <Link
                href={`/dashboard/${workspaceId}`}
                className="text-sm transition-colors"
                style={{ color: 'var(--text-tertiary)' }}
              >
                Cancel
              </Link>
            )}
          </div>
          <div>
            {step !== 'build' ? (
              <button
                type="button"
                onClick={next}
                disabled={!canProceed}
                className="font-medium text-sm h-10 px-6 rounded-lg transition-colors inline-flex items-center justify-center"
                style={
                  !canProceed
                    ? {
                        background: 'var(--surface-tertiary)',
                        color: 'var(--text-muted)',
                        cursor: 'not-allowed',
                      }
                    : {
                        background: 'var(--btn-primary-bg)',
                        color: 'var(--btn-primary-text)',
                      }
                }
              >
                Continue &rarr;
              </button>
            ) : (
              <button
                type="button"
                onClick={handleCreate}
                disabled={saving || !canCreate}
                className="font-medium text-sm h-10 px-6 rounded-lg transition-colors inline-flex items-center justify-center"
                style={
                  saving || !canCreate
                    ? {
                        background: 'var(--surface-tertiary)',
                        color: 'var(--text-muted)',
                        cursor: 'not-allowed',
                      }
                    : {
                        background: 'var(--btn-primary-bg)',
                        color: 'var(--btn-primary-text)',
                      }
                }
              >
                {saving ? 'Creating...' : 'Create Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
