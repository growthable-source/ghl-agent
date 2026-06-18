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

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { COPILOT_VOICES, ROTATE_VOICE } from '@/lib/copilot/voices'

interface KnowledgeDomainLite {
  id: string
  name: string
  description: string | null
  chunkCount: number
}

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
  const [voice, setVoice] = useState('')
  const [appContext, setAppContext] = useState('')
  const [domains, setDomains] = useState<KnowledgeDomainLite[]>([])
  const [domainPick, setDomainPick] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Play a short sample of the currently-selected voice. Rotate has no
  // single voice to sample, so the button is disabled for it.
  const playPreview = useCallback(async () => {
    if (voice === ROTATE_VOICE) return
    setPreviewError(null)
    setPreviewing(true)
    try {
      audioRef.current?.pause()
      const a = new Audio(`/api/copilot/voice-preview?voice=${encodeURIComponent(voice)}`)
      audioRef.current = a
      a.onended = () => setPreviewing(false)
      a.onerror = () => { setPreviewing(false); setPreviewError('Could not play a sample. Try again.') }
      await a.play()
    } catch {
      setPreviewing(false)
      setPreviewError('Could not play a sample. Try again.')
    }
  }, [voice])

  useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/admin/knowledge-domains?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => setDomains(d.domains ?? []))
      .catch(() => undefined)
  }, [workspaceId])

  const toggleDomain = useCallback((id: string) => {
    setDomainPick(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))
  }, [])

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
          // Support is reactive — never persist steps for it, even if the
          // field held leftover text from a prior template pick.
          steps: template.type === 'support' ? [] : stepsText.split('\n').map(s => s.trim()).filter(Boolean),
          timeboxMinutes: Number(minutes) || 30,
          voice,
          appContext,
          knowledgeDomainIds: domainPick,
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
  }, [workspaceId, name, template, persona, openingLine, collectInfo, stepsText, minutes, voice, appContext, domainPick, router])

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
          <label className="block text-xs font-medium text-zinc-400 mb-1">Application focus</label>
          <input
            value={appContext}
            onChange={e => setAppContext(e.target.value)}
            placeholder="e.g. the GoHighLevel dashboard / our billing portal at app.acme.com"
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none"
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            The one app this agent works inside — it grounds instructions in that product&rsquo;s real screens instead
            of guessing, and steers the user back if they wander off. Leave blank for a general assistant.
          </p>
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
          <label className="block text-xs font-medium text-zinc-400 mb-1">Voice</label>
          <div className="flex gap-2">
            <select
              value={voice}
              onChange={e => { setVoice(e.target.value); setPreviewError(null) }}
              className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none"
            >
              <option value="">Default voice</option>
              <option value={ROTATE_VOICE}>Rotate — a new voice &amp; name each session (like a team of people)</option>
              {COPILOT_VOICES.map(v => (
                <option key={v.id} value={v.id}>{v.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void playPreview()}
              disabled={previewing || voice === ROTATE_VOICE}
              title={voice === ROTATE_VOICE ? 'Rotate uses a different voice each session — nothing single to preview' : 'Hear a sample of this voice'}
              className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-40"
              style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-secondary)' }}
            >
              {previewing ? '♪ Playing…' : '▶ Preview'}
            </button>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">
            Pick one and the agent keeps that voice every call; choose <strong>Rotate</strong> and each session opens
            with a different voice and human name, like a real team. Hit <strong>Preview</strong> to hear it first.
          </p>
          {previewError && <p className="text-[11px] mt-1" style={{ color: 'var(--accent-red)' }}>{previewError}</p>}
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
        {/* The procedure section is the structural fork between the two
            kinds. Support is REACTIVE — it diagnoses and resolves whatever
            comes, so a step sequence makes no sense and would (wrongly) make
            it narrate "step 1 of N". Onboarding/Other are PROCEDURAL — the
            steps + timebox are the whole point, so they lead. */}
        {template.type === 'support' ? (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-4 py-3">
            <p className="text-xs text-zinc-400">
              <strong className="text-zinc-200">Reactive agent.</strong> It listens, diagnoses, and resolves whatever the
              user brings — no fixed steps, no &ldquo;step 1 of 3.&rdquo; It leans on your connected knowledge to find the fix.
              Want a guided, step-by-step call instead? Pick <strong className="text-zinc-200">Onboarding</strong>.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--accent-primary)' }}>
            <p className="text-xs text-zinc-400 mb-3">
              <strong className="text-zinc-200">Procedural agent.</strong> It leads the call through these steps in order,
              tracking progress aloud (&ldquo;step 3 of {Math.max(stepsText.split('\n').filter(s => s.trim()).length, 1)}&rdquo;)
              against the timebox. This sequence is what makes it procedural — without steps it behaves like a reactive Support agent.
            </p>
            <div className="flex gap-3 flex-wrap">
              <div className="flex-1 min-w-[240px]">
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  Procedure steps <span className="text-zinc-600">(one per line)</span>
                </label>
                <textarea
                  value={stepsText}
                  onChange={e => setStepsText(e.target.value)}
                  rows={6}
                  placeholder={'Welcome the user and confirm their goal\nConnect their CRM\nImport their first contacts\nRecap what was set up'}
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
          </div>
        )}

        {/* Connect knowledge */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
          <h3 className="text-sm font-semibold text-zinc-100 mb-1">Knowledge</h3>
          <p className="text-xs text-zinc-400 mb-3">
            Connect this co-pilot to your indexed knowledge — the same articles, docs, and videos your text and voice
            agents use. It searches this during a session to answer questions and look up the fix. Leave all unchecked
            to use every domain in the workspace. You can change this any time in the editor.
          </p>
          {domains.length === 0 ? (
            <p className="text-xs text-zinc-500">
              No knowledge domains yet —{' '}
              <Link href={`/dashboard/${workspaceId}/knowledge`} className="underline hover:text-zinc-300">
                add knowledge
              </Link>{' '}
              first, then connect it here or in the editor.
            </p>
          ) : (
            <div className="space-y-1.5">
              {domains.map(d => {
                const checked = domainPick.includes(d.id)
                return (
                  <label
                    key={d.id}
                    className="flex items-start gap-2.5 rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 cursor-pointer hover:border-zinc-700"
                  >
                    <input type="checkbox" checked={checked} onChange={() => toggleDomain(d.id)} className="mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-sm text-zinc-200 truncate">{d.name}</span>
                      {d.description && <span className="block text-xs text-zinc-500 truncate">{d.description}</span>}
                      <span className="block text-[11px] text-zinc-600">{d.chunkCount} indexed entries</span>
                    </span>
                  </label>
                )
              })}
              <p className="text-[11px] text-zinc-500 pt-1">
                {domainPick.length === 0
                  ? 'Nothing checked — this agent will read from all knowledge domains.'
                  : `Reading from ${domainPick.length} domain${domainPick.length === 1 ? '' : 's'}.`}
              </p>
            </div>
          )}
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
