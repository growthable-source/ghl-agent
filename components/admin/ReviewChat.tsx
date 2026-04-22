'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  agentId: string
  contactId: string
  agentName: string
}

interface ReviewMessage {
  role: 'admin' | 'assistant'
  content: string
  at: string
}

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
          <div
            key={i}
            className={m.role === 'admin'
              ? 'ml-auto max-w-[85%] bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200'
              : 'mr-auto max-w-[95%] bg-blue-500/10 border border-blue-500/30 rounded-lg px-3 py-2 text-blue-50'
            }
          >
            <div className="text-[10px] uppercase tracking-wider mb-1 opacity-70">
              {m.role === 'admin' ? 'You' : 'Reviewer'}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
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
