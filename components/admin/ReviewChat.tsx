'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'

interface Props {
  agentId: string
  contactId: string
  agentName: string
}

interface Suggestion {
  learningId: string
  type: 'prompt_addition'
  scope: 'this_agent' | 'workspace' | 'all_agents'
  title: string
  content: string
  rationale: string | null
}

function scopeChipClass(scope: Suggestion['scope']): string {
  if (scope === 'all_agents') return 'text-purple-300 bg-purple-500/15 border-purple-500/40'
  if (scope === 'workspace') return 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30'
  return 'text-zinc-400 bg-zinc-900 border-zinc-800'
}

interface ReviewMessage {
  role: 'admin' | 'assistant'
  content: string
  at: string
  suggestions?: Suggestion[]
}

type SuggestionStatus = 'proposed' | 'approved' | 'applied' | 'rejected' | 'retired'

/**
 * Meta-Claude review chat panel.
 *
 * One session == one AgentReview row. The admin types in the box, we
 * POST to /api/admin/conversation-review/chat, the server calls Claude
 * with the full agent-config + transcript as context and appends both
 * the admin message and the response to the review row. We render the
 * whole thread on every response — simpler than diffing and the thread
 * never gets long enough to matter.
 */
export default function ReviewChat({ agentId, contactId, agentName }: Props) {
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [messages, setMessages] = useState<ReviewMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Per-suggestion status map so the inline cards can flip to approved/
  // rejected/applied without a page reload. Keyed by learningId.
  const [suggestionStatus, setSuggestionStatus] = useState<Record<string, SuggestionStatus>>({})
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Auto-scroll as new messages land. Only runs when the list actually
    // grows, so the admin can manually scroll through without fighting us.
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  async function send() {
    const text = draft.trim()
    if (!text || sending) return
    setError(null)
    setSending(true)
    // Optimistic append — the admin's message appears instantly so the
    // panel feels responsive while Claude is thinking.
    const optimistic: ReviewMessage = { role: 'admin', content: text, at: new Date().toISOString() }
    setMessages(prev => [...prev, optimistic])
    setDraft('')
    try {
      const res = await fetch('/api/admin/conversation-review/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId, contactId, reviewId, message: text }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.error ?? 'Request failed')
      }
      setReviewId(data.reviewId)
      setMessages(data.messages)
    } catch (e: any) {
      // Roll back the optimistic message and let the admin retry.
      setMessages(prev => prev.slice(0, -1))
      setDraft(text)
      setError(e.message ?? 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  async function actOnSuggestion(
    learningId: string,
    action: 'approve' | 'apply' | 'reject',
  ) {
    setSuggestionBusy(learningId)
    try {
      const res = await fetch(`/api/admin/learnings/${learningId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Failed')
      // Map action → resulting status. Approve + apply is the happy
      // path; the two-step exists so the admin can review wording
      // before mutating the agent, but the card collapses the steps
      // visually by showing "Approve & Apply" as a single button once
      // approved (see below).
      const nextStatus: SuggestionStatus =
        action === 'approve' ? 'approved' :
        action === 'apply' ? 'applied' :
        'rejected'
      setSuggestionStatus(prev => ({ ...prev, [learningId]: nextStatus }))
    } catch (e: any) {
      setError(e.message ?? 'Failed')
    } finally {
      setSuggestionBusy(null)
    }
  }

  return (
    <aside className="rounded-lg border border-zinc-800 bg-zinc-950 flex flex-col h-[calc(100vh-8rem)] min-h-[500px]">
      <header className="px-4 py-3 border-b border-zinc-800">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
          Review with AI
        </p>
        <p className="text-xs text-zinc-500 mt-0.5">
          Ask the reviewer where <span className="text-zinc-300">{agentName}</span> went wrong.
          It sees the agent&apos;s prompt, rules, and the full transcript.
        </p>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {messages.length === 0 && (
          <div className="text-xs text-zinc-500 space-y-2">
            <p>Try prompts like:</p>
            <ul className="list-disc pl-4 space-y-1 text-zinc-400">
              <li>&ldquo;Why did the agent ask for the email twice?&rdquo;</li>
              <li>&ldquo;Was there a better point to call transfer_to_human?&rdquo;</li>
              <li>&ldquo;What rule or prompt change would stop this mistake?&rdquo;</li>
            </ul>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'admin' ? 'flex flex-col items-end' : 'flex flex-col items-start'}>
            <div
              className={m.role === 'admin'
                ? 'max-w-[85%] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200'
                : 'max-w-[95%] bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-blue-50'
              }
            >
              <div className="text-[10px] uppercase tracking-wider mb-1 opacity-70">
                {m.role === 'admin' ? 'You' : 'Reviewer'}
              </div>
              <div className="whitespace-pre-wrap">{m.content}</div>
            </div>
            {/* Inline suggestion cards — only present on assistant turns
                that produced one or more propose_improvement tool calls. */}
            {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
              <div className="w-full max-w-[95%] mt-2 space-y-2">
                {m.suggestions.map(s => {
                  const status = suggestionStatus[s.learningId] ?? 'proposed'
                  const busy = suggestionBusy === s.learningId
                  return (
                    <div
                      key={s.learningId}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2"
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-300 bg-amber-500/20 rounded px-1.5 py-0.5">
                          {status}
                        </span>
                        <span className={`text-[10px] font-semibold uppercase tracking-wider rounded px-1.5 py-0.5 border ${scopeChipClass(s.scope)}`}>
                          {s.scope.replace(/_/g, ' ')}
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 bg-zinc-900 rounded px-1.5 py-0.5">
                          {s.type.replace(/_/g, ' ')}
                        </span>
                        <span className="text-xs text-zinc-200 font-medium">{s.title}</span>
                      </div>
                      <pre className="text-[11px] text-zinc-300 whitespace-pre-wrap bg-zinc-900/50 p-2 rounded border border-zinc-800 font-sans">
                        {s.content}
                      </pre>
                      {s.rationale && (
                        <p className="text-[11px] text-zinc-500 italic">{s.rationale}</p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {status === 'proposed' && (
                          <>
                            <button
                              type="button"
                              onClick={() => actOnSuggestion(s.learningId, 'approve')}
                              disabled={busy}
                              className="text-[11px] font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white rounded px-2.5 py-1 transition-colors"
                            >
                              {busy ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                              type="button"
                              onClick={() => actOnSuggestion(s.learningId, 'reject')}
                              disabled={busy}
                              className="text-[11px] font-medium border border-red-500/30 text-red-300 hover:text-red-200 hover:border-red-500/50 rounded px-2.5 py-1 transition-colors"
                            >
                              Reject
                            </button>
                            <Link
                              href={`/admin/learnings?status=proposed`}
                              className="text-[11px] text-zinc-500 hover:text-zinc-300 ml-auto"
                            >
                              Edit wording →
                            </Link>
                          </>
                        )}
                        {status === 'approved' && (
                          <>
                            <button
                              type="button"
                              onClick={() => actOnSuggestion(s.learningId, 'apply')}
                              disabled={busy}
                              className="text-[11px] font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white rounded px-2.5 py-1 transition-colors"
                            >
                              {busy ? 'Applying…' : 'Apply to agent'}
                            </button>
                            <span className="text-[11px] text-emerald-300">Approved — ready to apply</span>
                          </>
                        )}
                        {status === 'applied' && (
                          <span className="text-[11px] text-emerald-300">
                            ✓ Applied to agent&apos;s system prompt
                          </span>
                        )}
                        {status === 'rejected' && (
                          <span className="text-[11px] text-zinc-500">Rejected</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="mr-auto max-w-[95%] bg-blue-500/5 border border-blue-500/20 rounded-lg px-3 py-2 text-blue-100/70 text-xs italic">
            Reviewing…
          </div>
        )}
      </div>

      {error && (
        <div className="px-4 py-2 text-xs text-red-300 bg-red-500/10 border-t border-red-500/30">
          {error}
        </div>
      )}

      <div className="border-t border-zinc-800 p-3">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            // Cmd/Ctrl+Enter to send — Shift+Enter keeps its normal newline
            // behaviour so operators can write multi-paragraph questions.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
          disabled={sending}
          placeholder="Ask what went wrong, or suggest a fix…"
          rows={3}
          className="w-full bg-zinc-900 border border-zinc-800 rounded px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600 disabled:opacity-50"
        />
        <div className="flex items-center justify-between mt-2">
          <p className="text-[10px] text-zinc-600">
            ⌘ + Enter to send · messages persist as a review
          </p>
          <button
            type="button"
            onClick={send}
            disabled={sending || !draft.trim()}
            className="text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-lg px-3 py-1.5 transition-colors"
          >
            {sending ? 'Reviewing…' : 'Send'}
          </button>
        </div>
      </div>
    </aside>
  )
}
