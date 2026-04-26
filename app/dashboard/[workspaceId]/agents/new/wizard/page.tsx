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

interface Proposal {
  name: string
  summary: string
  systemPrompt: string
  instructions: string
  enabledTools: string[]
  detectionRules?: DetectionRule[]
  qualifyingQuestions?: QualifyingQuestion[]
  personaTone?: string
}

const SEED_GREETING: Msg = {
  role: 'assistant',
  content: "Hey — I'll help you build an agent in a couple of minutes. What do you want this agent to do? (e.g. \"book demos for our SaaS product\", \"answer support questions for an HVAC company\", \"qualify real-estate buyers and capture their budget\")",
}

export default function WizardPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [messages, setMessages] = useState<Msg[]>([SEED_GREETING])
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
        body: JSON.stringify({ messages: next }),
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
        body: JSON.stringify({ proposal }),
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
          Describe what you want and I&apos;ll spin up the agent — system prompt, rules, qualifying questions, tools, all of it.
        </p>
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
