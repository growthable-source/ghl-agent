'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import {
  SmsIcon, WhatsAppIcon, FacebookIcon, InstagramIcon,
  GoogleIcon, LiveChatIcon, EmailIcon,
  GoHighLevelIcon,
} from '@/components/icons/brand-icons'
import { BUSINESS_CONTEXT_EXAMPLES } from '@/lib/business-context-examples'
import { MergeFieldTextarea } from '@/components/MergeFieldHelper'

type Step = 'template' | 'crm' | 'calendar' | 'channels' | 'build'

const STEPS: { key: Step; label: string }[] = [
  { key: 'template', label: 'Type' },
  { key: 'crm', label: 'CRM' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'channels', label: 'Channels' },
  { key: 'build', label: 'Build' },
]

interface AgentTemplate {
  id: string
  initiation: 'outbound' | 'inbound'
  role: 'sales' | 'support' | 'assistant'
  name: string
  tagline: string
  icon: string
  systemPrompt: string
  instructions: string
  enabledTools: string[]
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
  },
]

// Static descriptor — `connected` state is resolved per-workspace at
// render time from /api/workspaces/:id/integrations. The previous
// hardcoded `connected: true` meant every new user saw "Already connected
// via OAuth" the very first time they hit the wizard, before they'd ever
// clicked Connect.
const CRM_OPTIONS = [
  { id: 'ghl', name: 'GoHighLevel', icon: <GoHighLevelIcon className="w-8 h-8" /> },
  { id: 'none', name: 'No CRM', desc: 'Skip for now — you can connect later', icon: null },
]

const CALENDAR_OPTIONS = [
  { id: 'ghl', name: 'GHL Calendar', desc: 'Use your GoHighLevel calendar', icon: <GoHighLevelIcon className="w-8 h-8" /> },
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
const ROLE_LABELS: Record<string, string> = { sales: 'Sales', support: 'Support', assistant: 'Assistant' }

export default function NewAgentWizard() {
  const router = useRouter()
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [step, setStep] = useState<Step>('template')
  const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null)
  const [selectedCrm, setSelectedCrm] = useState<string>('ghl')
  const [selectedCalendar, setSelectedCalendar] = useState<string>('ghl')
  const [selectedChannels, setSelectedChannels] = useState<string[]>(['SMS'])

  // Real GHL connection status for this workspace. New users haven't
  // installed yet — show them a Connect button; returning users see
  // "Connected" and continue.
  const [ghlConnected, setGhlConnected] = useState<boolean | null>(null)
  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/integrations`)
      .then(r => r.json())
      .then(d => setGhlConnected(!!d.ghlConnected))
      .catch(() => setGhlConnected(false))
  }, [workspaceId])

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
  // Track whether the user has hand-edited the name. Template changes only
  // overwrite the name while it's still template-derived — otherwise we'd
  // clobber a name the user typed. Previously this used `if (!name)` which
  // locked the name to whatever template was picked FIRST, even if the user
  // later switched templates (e.g. Outbound → Inbound Assistant stuck as
  // "Outbound Assistant Agent").
  const [nameManuallyEdited, setNameManuallyEdited] = useState(false)

  const currentIdx = STEPS.findIndex(s => s.key === step)

  function next() {
    const nextIdx = currentIdx + 1
    if (nextIdx < STEPS.length) setStep(STEPS[nextIdx].key)
  }

  function back() {
    const prevIdx = currentIdx - 1
    if (prevIdx >= 0) setStep(STEPS[prevIdx].key)
  }

  function selectTemplate(t: AgentTemplate) {
    setSelectedTemplate(t)
    // Update the name to match the new template unless the user has typed
    // their own name. System prompt and instructions always follow the
    // template — those are expected to reset on template change.
    if (!nameManuallyEdited) setName(t.name + ' Agent')
    setSystemPrompt(t.systemPrompt)
    setInstructions(t.instructions)
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
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error || `Failed to create agent (${res.status})`)
      }

      // Save channel deployments
      if (selectedChannels.length > 0) {
        await fetch(`/api/workspaces/${workspaceId}/agents/${data.agent.id}/channels`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channels: selectedChannels.map(ch => ({ channel: ch, isActive: true })),
          }),
        })
      }

      router.push(`/dashboard/${workspaceId}/agents/${data.agent.id}/deploy`)
    } catch (err: any) {
      setError(err.message || 'Something went wrong. Please try again.')
      setSaving(false)
    }
  }

  const canProceed = step !== 'template' || selectedTemplate !== null
  const canCreate = name.trim() && systemPrompt.trim()

  return (
    <div className="p-8">
      <div className="max-w-2xl mx-auto">
        {/* Progress bar */}
        <div className="flex items-center gap-1 mb-8">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  i < currentIdx ? 'bg-emerald-500 text-white' :
                  i === currentIdx ? 'bg-white text-black' :
                  'bg-zinc-800 text-zinc-500'
                }`}>
                  {i < currentIdx ? '✓' : i + 1}
                </div>
                <span className={`text-xs font-medium hidden sm:block ${
                  i <= currentIdx ? 'text-zinc-200' : 'text-zinc-600'
                }`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-px flex-1 mx-2 ${i < currentIdx ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
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

            {/* Outbound */}
            <div className="mb-6">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">Outbound — Agent initiates the conversation</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {TEMPLATES.filter(t => t.initiation === 'outbound').map(t => (
                  <button key={t.id} type="button" onClick={() => selectTemplate(t)}
                    className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                      selectedTemplate?.id === t.id
                        ? 'border-white bg-zinc-900'
                        : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                    }`}>
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
                    className={`flex flex-col gap-2 rounded-xl border p-4 text-left transition-colors ${
                      selectedTemplate?.id === t.id
                        ? 'border-white bg-zinc-900'
                        : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                    }`}>
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
            <h1 className="text-2xl font-semibold mb-2">Connect your CRM</h1>
            <p className="text-zinc-400 text-sm mb-6">Your agent will read contacts, update tags, and manage pipelines through your CRM.</p>
            <div className="space-y-3">
              {CRM_OPTIONS.map(opt => {
                // Render GHL with real connection state: "Connected" when
                // the workspace has an install, otherwise a Connect CTA
                // that kicks off the OAuth flow inline. The 'none' option
                // always shows its static description.
                const isGhl = opt.id === 'ghl'
                const isConnected = isGhl && ghlConnected === true
                const isChecking = isGhl && ghlConnected === null
                const desc = isGhl
                  ? (isChecking ? 'Checking…' : isConnected ? 'Connected via OAuth' : 'Not connected yet — click Connect below')
                  : (opt as any).desc
                return (
                  <div key={opt.id}>
                    <button type="button" onClick={() => setSelectedCrm(opt.id)}
                      className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                        selectedCrm === opt.id
                          ? 'border-white bg-zinc-900'
                          : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                      }`}>
                      <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">{opt.icon || <span className="text-2xl text-zinc-500">--</span>}</span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-zinc-200">{opt.name}</p>
                        <p className={`text-xs ${isGhl && !isConnected && !isChecking ? 'text-amber-400' : 'text-zinc-500'}`}>{desc}</p>
                      </div>
                      {isConnected && (
                        <span className="text-xs font-medium text-emerald-400 mr-2">✓</span>
                      )}
                      {selectedCrm === opt.id && (
                        <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                          <span className="w-2 h-2 rounded-full bg-black" />
                        </span>
                      )}
                    </button>

                    {/* Inline connect CTA when GHL is selected but not connected */}
                    {isGhl && selectedCrm === 'ghl' && ghlConnected === false && (
                      <a
                        href={`/api/auth/crm/connect?workspaceId=${workspaceId}`}
                        className="mt-2 inline-flex items-center rounded-lg bg-white text-black font-medium text-sm px-4 h-9 hover:bg-zinc-200 transition-colors"
                      >
                        Connect GoHighLevel →
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
            <p className="text-zinc-400 text-sm mb-6">Your agent will check availability and book appointments for leads.</p>
            <div className="space-y-3">
              {CALENDAR_OPTIONS.map(opt => (
                <button key={opt.id} type="button" onClick={() => setSelectedCalendar(opt.id)}
                  className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                    selectedCalendar === opt.id
                      ? 'border-white bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                  }`}>
                  <span className="w-8 h-8 flex items-center justify-center flex-shrink-0">{opt.icon || <span className="text-2xl text-zinc-500">--</span>}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">{opt.name}</p>
                    <p className="text-xs text-zinc-500">{opt.desc}</p>
                  </div>
                  {selectedCalendar === opt.id && (
                    <span className="w-5 h-5 rounded-full bg-white flex items-center justify-center">
                      <span className="w-2 h-2 rounded-full bg-black" />
                    </span>
                  )}
                </button>
              ))}
            </div>
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
                    className={`w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-colors ${
                      active
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                    }`}>
                    <span className={`w-8 flex items-center justify-center ${active ? ch.color : 'text-zinc-500'}`}>{ch.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${active ? 'text-white' : 'text-zinc-300'}`}>{ch.label}</p>
                      <p className="text-xs text-zinc-500">{ch.desc}</p>
                    </div>
                    <div className={`relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent transition-colors ${
                      active ? 'bg-emerald-500' : 'bg-zinc-700'
                    }`}>
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        active ? 'translate-x-4' : 'translate-x-0'
                      }`} />
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
                <label className="block text-sm font-medium text-zinc-300 mb-2">Agent Name</label>
                <input type="text" value={name}
                  onChange={e => { setName(e.target.value); setNameManuallyEdited(true) }}
                  placeholder="e.g. Sales Assistant"
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">System Prompt</label>
                <p className="text-xs text-zinc-500 mb-2">The core identity and role of the agent. Pre-filled from your template — edit as needed.</p>
                <textarea value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)}
                  placeholder="You are a helpful sales assistant for Acme Corp..."
                  rows={7}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y" />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Behavioral Instructions <span className="text-zinc-600">(optional)</span>
                </label>
                <p className="text-xs text-zinc-500 mb-2">Bullet-point rules the agent follows. Pre-filled from your template — edit as needed.</p>
                <textarea value={instructions} onChange={e => setInstructions(e.target.value)}
                  placeholder="- Always greet by first name&#10;- If they ask about pricing, send them the booking link"
                  rows={5}
                  className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y" />
              </div>

              {/* ── Context level picker ──
                  SIMPLE is the default and zero-overhead. ADVANCED pre-loads
                  the contact's recent opportunities + custom fields into the
                  system prompt so the agent can reason about commercial
                  context (ex: a car dealer's vehicle inquiries) without
                  calling tools. Costs more tokens per turn but produces a
                  much richer conversation for data-heavy domains. */}
              <div>
                <label className="block text-sm font-medium text-zinc-300 mb-2">
                  Context Level
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setAgentType('SIMPLE')}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      agentType === 'SIMPLE'
                        ? 'border-white bg-zinc-900'
                        : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <p className="text-sm font-medium text-zinc-200">Simple</p>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                      Name, tags, and conversation history only. Best for support bots, FAQ agents, and high-volume low-context use cases.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAgentType('ADVANCED')}
                    className={`text-left rounded-lg border p-3 transition-colors ${
                      agentType === 'ADVANCED'
                        ? 'border-emerald-500/60 bg-emerald-500/5'
                        : 'border-zinc-800 hover:border-zinc-600'
                    }`}
                  >
                    <p className="text-sm font-medium text-zinc-200 flex items-center gap-1.5">
                      Advanced
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5">
                        context
                      </span>
                    </p>
                    <p className="text-[11px] text-zinc-500 mt-1 leading-snug">
                      Also loads the contact's opportunities (last ~6 months) and custom fields. Best for sales agents that need to reason about deals, products, or pricing.
                    </p>
                  </button>
                </div>
              </div>

              {agentType === 'ADVANCED' && (
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-2">
                    Business Context <span className="text-zinc-600">(optional)</span>
                  </label>
                  <p className="text-xs text-zinc-500 mb-2">
                    Plain-English explanation of what your custom fields and opportunities represent. The agent reads this alongside the live data so it knows how to interpret what it&apos;s seeing. Merge fields like <span className="font-mono text-zinc-400">{'{{contact.first_name|there}}'}</span> and <span className="font-mono text-zinc-400">{'{{user.name|our team}}'}</span> resolve per-contact at runtime.
                  </p>

                  {/* Starter templates — operators told us a placeholder
                      alone doesn't register as "actual content." Explicit
                      pickers that write into the textarea fix that. */}
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 mb-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">
                      Start from an example
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {BUSINESS_CONTEXT_EXAMPLES.map(ex => (
                        <button
                          key={ex.id}
                          type="button"
                          onClick={() => setBusinessContext(ex.body)}
                          className="text-xs text-zinc-300 bg-zinc-900 border border-zinc-700 hover:border-zinc-500 hover:text-white rounded-full px-3 py-1 transition-colors"
                          title={ex.description}
                        >
                          {ex.label}
                        </button>
                      ))}
                      {businessContext.trim() && (
                        <button
                          type="button"
                          onClick={() => setBusinessContext('')}
                          className="text-xs text-zinc-500 hover:text-red-400 transition-colors px-2"
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
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-4 pt-10 pb-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
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

              {error && <p className="text-red-400 text-sm">{error}</p>}
            </div>
          </div>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-zinc-800">
          <div>
            {currentIdx > 0 ? (
              <button type="button" onClick={back}
                className="text-sm text-zinc-400 hover:text-white transition-colors flex items-center gap-1">
                &larr; Back
              </button>
            ) : (
              <Link href={`/dashboard/${workspaceId}`} className="text-sm text-zinc-500 hover:text-white transition-colors">
                Cancel
              </Link>
            )}
          </div>
          <div>
            {step !== 'build' ? (
              <button type="button" onClick={next} disabled={!canProceed}
                className="bg-white text-black font-medium text-sm h-10 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 inline-flex items-center justify-center">
                Continue &rarr;
              </button>
            ) : (
              <button type="button" onClick={handleCreate} disabled={saving || !canCreate}
                className="bg-white text-black font-medium text-sm h-10 px-6 rounded-lg hover:bg-zinc-200 transition-colors disabled:opacity-50 inline-flex items-center justify-center">
                {saving ? 'Creating...' : 'Create Agent'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
