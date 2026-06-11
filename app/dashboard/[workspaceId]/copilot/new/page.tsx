'use client'

/**
 * Create a Co-Pilot agent.
 *
 * Mirrors the register of the voice wizard (/voice/new): a use-case
 * template choice, then the details. Co-Pilot creation is simpler than
 * voice (no phone/voice provider), so it's one screen rather than a
 * stepper — but the visual language and "pick a template → name it →
 * create" shape match. On create it POSTs and lands on the agent's
 * editor, where the operator adds knowledge + recordings/documents.
 */

import { useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Template {
  key: string
  type: 'support' | 'onboarding' | 'other'
  name: string
  blurb: string
  steps: string[]
  persona: string
  openingLine: string
  collectInfo: string
  timebox: number
}

const TEMPLATES: Template[] = [
  {
    key: 'support',
    type: 'support',
    name: 'Support',
    blurb: 'Fixes anything — diagnoses and solves whatever the user brings.',
    persona: 'Calm, sharp, and practical. Diagnoses before prescribing. Gives one clear next action at a time.',
    openingLine: 'Greet the user warmly, introduce yourself by name, confirm you can see their screen, and ask what they need help with today.',
    collectInfo: '',
    timebox: 30,
    steps: [],
  },
  {
    key: 'onboarding',
    type: 'onboarding',
    name: 'Onboarding',
    blurb: 'Runs a structured onboarding call: directions, SOP steps, timebox.',
    persona: 'Warm, patient, and encouraging. Explains the why, not just the click. Never rushes — confirms each step landed before moving on.',
    openingLine: 'Welcome them to their onboarding session, introduce yourself by name, set expectations for what you will cover and roughly how long it takes, then begin step 1.',
    collectInfo: 'Their name and role; the business name; what outcome matters most to them from this product.',
    timebox: 30,
    steps: [
      'Welcome the user and confirm what they want to achieve today',
      'Connect their CRM / core integration',
      'Import or add their first contacts',
      'Create and configure their first agent',
      'Deploy to a channel and send a test',
      'Recap what was set up and what comes next',
    ],
  },
  {
    key: 'other',
    type: 'other',
    name: 'Other',
    blurb: 'A blank agent you shape yourself.',
    persona: '',
    openingLine: '',
    collectInfo: '',
    timebox: 30,
    steps: [],
  },
]

export default function NewCopilotAgentPage() {
  const params = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const workspaceId = params?.workspaceId

  const [template, setTemplate] = useState<Template>(TEMPLATES[0])
  const [name, setName] = useState('')
  const [persona, setPersona] = useState(TEMPLATES[0].persona)
  const [openingLine, setOpeningLine] = useState(TEMPLATES[0].openingLine)
  const [collectInfo, setCollectInfo] = useState(TEMPLATES[0].collectInfo)
  const [stepsText, setStepsText] = useState(TEMPLATES[0].steps.join('\n'))
  const [minutes, setMinutes] = useState('30')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickTemplate = useCallback((t: Template) => {
    setTemplate(t)
    setPersona(t.persona)
    setOpeningLine(t.openingLine)
    setCollectInfo(t.collectInfo)
    setStepsText(t.steps.join('\n'))
    setMinutes(String(t.timebox))
  }, [])

  const create = useCallback(async () => {
    if (!name.trim()) {
      setError('Give your agent a name.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/copilot/agents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          type: template.type,
          persona,
          openingLine,
          collectInfo,
          steps: stepsText.split('\n').map(s => s.trim()).filter(Boolean),
          timeboxMinutes: Number(minutes) || 30,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.agentId) {
        setError(body.error || 'Could not create the agent.')
        return
      }
      router.push(`/dashboard/${workspaceId}/copilot/agents/${body.agentId}`)
    } finally {
      setSubmitting(false)
    }
  }, [workspaceId, name, template, persona, openingLine, collectInfo, stepsText, minutes, router])

  if (!workspaceId) return null

  return (
    <div className="max-w-3xl mx-auto px-6 py-8 w-full">
      <Link href={`/dashboard/${workspaceId}/copilot`} className="text-sm text-zinc-400 hover:text-zinc-200">
        ← Co-Pilot agents
      </Link>
      <h1 className="text-3xl font-semibold text-zinc-100 mt-3 mb-1">New Co-Pilot agent</h1>
      <p className="text-zinc-400 mb-6 max-w-2xl">
        Pick the agent type, give it directions, then teach it from recordings and SOP documents. Once published, launch it from a link, a button, or a JavaScript snippet in any app.
      </p>

      {/* Template choice */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
        {TEMPLATES.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => pickTemplate(t)}
            className="rounded-xl border p-4 text-left transition-colors"
            style={
              template.key === t.key
                ? { borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }
                : { borderColor: 'var(--border-secondary)', background: 'var(--surface)' }
            }
          >
            <p className="text-sm font-semibold text-zinc-100">{t.name}</p>
            <p className="text-xs text-zinc-400 mt-1">{t.blurb}</p>
          </button>
        ))}
      </div>

      <div className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Onboarding Olivia"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Persona / tone</label>
          <textarea
            value={persona}
            onChange={e => setPersona(e.target.value)}
            rows={3}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">How to start the call</label>
          <textarea
            value={openingLine}
            onChange={e => setOpeningLine(e.target.value)}
            rows={2}
            placeholder="e.g. Welcome them, introduce yourself, set expectations, then begin."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-400 mb-1">Information to ask the user for</label>
          <textarea
            value={collectInfo}
            onChange={e => setCollectInfo(e.target.value)}
            rows={2}
            placeholder="e.g. Their name and role; the business name; their main goal."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
        </div>
        <div className="flex gap-3 flex-wrap">
          <div className="flex-1 min-w-[240px]">
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Procedure steps <span className="text-zinc-600">(one per line — leave blank for general support)</span>
            </label>
            <textarea
              value={stepsText}
              onChange={e => setStepsText(e.target.value)}
              rows={6}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
            />
          </div>
          <div className="w-32">
            <label className="block text-xs font-medium text-zinc-400 mb-1">Timebox (min)</label>
            <input
              value={minutes}
              onChange={e => setMinutes(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            />
          </div>
        </div>

        {error && <p className="text-sm" style={{ color: 'var(--accent-red)' }}>{error}</p>}

        <button
          type="button"
          onClick={() => void create()}
          disabled={submitting}
          className="px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
          style={{ background: 'var(--accent-primary)' }}
        >
          {submitting ? 'Creating…' : 'Create agent'}
        </button>
      </div>
    </div>
  )
}
