'use client'

import { useState, useRef, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface Msg { role: 'user' | 'assistant'; content: string }

interface DetectionRule {
  name: string
  description: string
  actionType: 'add_tag' | 'add_note' | 'add_to_workflow'
  actionValue: string
}
interface QualifyingQuestion { question: string; captureField: string }
interface ProcedureStepProposal {
  title: string
  instruction: string
  question?: string
  rules?: { when: string; action: 'skip' | 'jump' | 'stop'; target?: string }[]
}

type AgentKind = 'reactive' | 'procedural'
type ProcedureMode = 'simple' | 'advanced'

interface Proposal {
  name: string
  summary: string
  systemPrompt: string
  instructions: string
  enabledTools: string[]
  detectionRules?: DetectionRule[]
  qualifyingQuestions?: QualifyingQuestion[]
  procedureSteps?: ProcedureStepProposal[]
  personaTone?: string
}

function greetingFor(kind: AgentKind): Msg {
  return {
    role: 'assistant',
    content: kind === 'procedural'
      ? "Great — a procedural agent walks someone through a sequence step by step. What's the procedure? (e.g. \"onboard a new client\", \"book a discovery call and collect their goals\", \"run through an intake form\")"
      : "Great — a reactive agent listens, diagnoses, and resolves using your knowledge. What should it help with? (e.g. \"answer support questions for an HVAC company\", \"triage product issues\", \"handle billing questions\")",
  }
}

export default function WizardPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  // Type choice gates the whole wizard — it frames the conversation and the
  // proposal. null until the user picks, which is when the chat begins.
  const [kind, setKind] = useState<AgentKind | null>(null)
  const [procedureMode, setProcedureMode] = useState<ProcedureMode>('simple')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy, proposal])

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    const content = input.trim()
    if (!content || busy) return
    const next = [...messages, { role: 'user' as const, content }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/wizard`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, kind, procedureMode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Wizard error')
        return
      }
      if (data.proposal) {
        setProposal(data.proposal)
        if (data.summary) {
          setMessages(m => [...m, { role: 'assistant', content: data.summary }])
        }
      } else if (data.reply) {
        setMessages(m => [...m, { role: 'assistant', content: data.reply }])
      }
    } catch (err: any) {
      setError(err.message || 'Network error')
    } finally { setBusy(false) }
  }

  async function createAgent() {
    if (!proposal) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/agents/wizard/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal, kind, procedureMode }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Could not create agent')
        return
      }
      router.push(`/dashboard/${workspaceId}/agents/${data.agentId}`)
    } finally { setCreating(false) }
  }

  function tweak() {
    setProposal(null)
    setMessages(m => [...m, { role: 'assistant', content: "Got it — what should I change?" }])
  }

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <Link href={`/dashboard/${workspaceId}/agents/new`} className="text-xs text-zinc-500 hover:text-zinc-300">
          ← Back to manual setup
        </Link>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Build with AI</h1>
        <p className="text-sm text-zinc-400 mt-1">
          {kind === null
            ? 'First, what kind of agent is this? It shapes how the agent behaves.'
            : 'Describe what you want and I’ll spin up the agent — system prompt, rules, tools, all of it.'}
        </p>
      </div>

      {kind === null && (
        <TypePicker
          onPick={(k, m) => {
            setKind(k)
            setProcedureMode(m)
            setMessages([greetingFor(k)])
          }}
        />
      )}

      {kind !== null && (<>
      <div className="mb-3 flex items-center gap-2 text-xs">
        <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 capitalize">
          {kind}{kind === 'procedural' ? ` · ${procedureMode}` : ''}
        </span>
        <button
          onClick={() => { setKind(null); setProposal(null); setMessages([]); setInput('') }}
          className="text-zinc-500 hover:text-zinc-300"
        >
          Change type
        </button>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 mb-4 space-y-4">
        {messages.map((m, i) => (
          <Bubble key={i} msg={m} />
        ))}
        {busy && (
          <div className="flex gap-1 pl-2">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '0ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
        {proposal && <ProposalCard proposal={proposal} onCreate={createAgent} onTweak={tweak} creating={creating} />}
      </div>

      {error && (
        <div className="mb-3 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-300">{error}</div>
      )}

      <form onSubmit={send} className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder={proposal ? 'Ask for any changes…' : 'Describe what you want this agent to do…'}
          rows={2}
          disabled={busy || creating}
          className="flex-1 resize-none bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 max-h-32"
        />
        <button
          type="submit"
          disabled={!input.trim() || busy || creating}
          className="text-xs font-semibold px-4 py-2.5 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-40"
          style={{ background: '#fa4d2e' }}
        >
          Send
        </button>
      </form>
      </>)}
    </div>
  )
}

function TypePicker({ onPick }: { onPick: (kind: AgentKind, mode: ProcedureMode) => void }) {
  const [pendingProcedural, setPendingProcedural] = useState(false)
  return (
    <div className="flex-1 flex flex-col justify-center gap-4 max-w-2xl mx-auto w-full">
      <button
        onClick={() => onPick('reactive', 'simple')}
        className="text-left rounded-xl border-2 p-5 transition-colors border-zinc-800 hover:border-orange-500/50 bg-zinc-900/40"
      >
        <p className="text-base font-bold text-white">Reactive <span className="text-[10px] font-medium text-zinc-400 uppercase tracking-wider ml-1">default</span></p>
        <p className="text-sm text-zinc-400 mt-1">Listens, diagnoses, and resolves using your knowledge. No fixed steps. Best for support, FAQ, triage, Q&amp;A.</p>
      </button>

      <div className={`rounded-xl border-2 p-5 transition-colors ${pendingProcedural ? 'border-orange-500/50' : 'border-zinc-800 hover:border-orange-500/50'} bg-zinc-900/40`}>
        <button onClick={() => setPendingProcedural(v => !v)} className="text-left w-full">
          <p className="text-base font-bold text-white">Procedural</p>
          <p className="text-sm text-zinc-400 mt-1">Walks the contact through a defined sequence with progress (&ldquo;step 2 of 3&rdquo;). Best for onboarding, intake, booking, guided flows.</p>
        </button>
        {pendingProcedural && (
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <p className="text-[11px] text-zinc-500 uppercase tracking-wider mb-2">Choose authoring mode</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                onClick={() => onPick('procedural', 'simple')}
                className="text-left rounded-lg border border-zinc-700 hover:border-zinc-500 p-3"
              >
                <p className="text-sm font-medium text-white">Simple</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">Ordered written steps.</p>
              </button>
              <button
                onClick={() => onPick('procedural', 'advanced')}
                className="text-left rounded-lg border border-zinc-700 hover:border-zinc-500 p-3"
              >
                <p className="text-sm font-medium text-white">Advanced</p>
                <p className="text-[11px] text-zinc-400 mt-0.5">Steps can ask questions &amp; branch (skip / jump / stop).</p>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Bubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm whitespace-pre-wrap ${
          isUser ? 'rounded-tr-sm bg-orange-500/15 text-white' : 'rounded-tl-sm bg-zinc-800 text-zinc-100'
        }`}
      >
        {msg.content}
      </div>
    </div>
  )
}

function ProposalCard({
  proposal, onCreate, onTweak, creating,
}: {
  proposal: Proposal
  onCreate: () => void
  onTweak: () => void
  creating: boolean
}) {
  return (
    <div className="rounded-xl border-2 border-orange-500/40 bg-orange-500/5 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-[10px] text-orange-300 uppercase tracking-wider font-semibold mb-0.5">Proposed agent</p>
          <h3 className="text-base font-bold text-white">{proposal.name}</h3>
        </div>
        {proposal.personaTone && (
          <span className="text-[10px] text-zinc-400 px-2 py-0.5 rounded-full bg-zinc-800 uppercase tracking-wider">
            {proposal.personaTone}
          </span>
        )}
      </div>
      <p className="text-sm text-zinc-200 mb-4">{proposal.summary}</p>

      <details className="mb-3">
        <summary className="text-[11px] font-semibold text-zinc-300 cursor-pointer hover:text-white">System prompt</summary>
        <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap mt-2 p-3 bg-zinc-950 rounded-lg border border-zinc-800 max-h-48 overflow-y-auto">{proposal.systemPrompt}</pre>
      </details>

      {proposal.instructions && (
        <details className="mb-3">
          <summary className="text-[11px] font-semibold text-zinc-300 cursor-pointer hover:text-white">Behavior rules</summary>
          <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap mt-2 p-3 bg-zinc-950 rounded-lg border border-zinc-800 max-h-32 overflow-y-auto">{proposal.instructions}</pre>
        </details>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {proposal.enabledTools.length > 0 && (
          <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Tools ({proposal.enabledTools.length})</p>
            <div className="flex flex-wrap gap-1">
              {proposal.enabledTools.map(t => (
                <code key={t} className="text-[10px] bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{t}</code>
              ))}
            </div>
          </div>
        )}
        {proposal.detectionRules && proposal.detectionRules.length > 0 && (
          <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Rules ({proposal.detectionRules.length})</p>
            <ul className="space-y-1">
              {proposal.detectionRules.map((r, i) => (
                <li key={i} className="text-[11px] text-zinc-300">
                  <strong className="text-white">{r.name}</strong> · {r.description}
                </li>
              ))}
            </ul>
          </div>
        )}
        {proposal.procedureSteps && proposal.procedureSteps.length > 0 && (
          <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 md:col-span-2">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Procedure ({proposal.procedureSteps.length} steps)</p>
            <ol className="space-y-1 list-decimal list-inside">
              {proposal.procedureSteps.map((s, i) => (
                <li key={i} className="text-[11px] text-zinc-300">
                  <strong className="text-white">{s.title}</strong>
                  <span className="text-zinc-500"> — {s.instruction}</span>
                  {s.rules && s.rules.length > 0 && (
                    <span className="text-zinc-600"> · {s.rules.length} rule{s.rules.length > 1 ? 's' : ''}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        )}
        {proposal.qualifyingQuestions && proposal.qualifyingQuestions.length > 0 && (
          <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 md:col-span-2">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1.5">Qualifying questions ({proposal.qualifyingQuestions.length})</p>
            <ul className="space-y-1">
              {proposal.qualifyingQuestions.map((q, i) => (
                <li key={i} className="text-[11px] text-zinc-300">
                  &ldquo;{q.question}&rdquo; <span className="text-zinc-500">→ captures as <code className="bg-zinc-800 px-1 rounded">{q.captureField}</code></span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-zinc-800">
        <button
          onClick={onCreate}
          disabled={creating}
          className="text-sm font-semibold px-5 py-2 rounded-lg text-white hover:opacity-90 transition-opacity disabled:opacity-50"
          style={{ background: '#22c55e' }}
        >
          {creating ? 'Creating…' : '✓ Create this agent'}
        </button>
        <button
          onClick={onTweak}
          className="text-sm font-medium px-4 py-2 rounded-lg text-zinc-300 border border-zinc-700 hover:text-white hover:border-zinc-500 transition-colors"
        >
          Tweak it
        </button>
      </div>
    </div>
  )
}
