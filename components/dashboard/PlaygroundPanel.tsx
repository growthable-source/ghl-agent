'use client'

import { useState, useRef } from 'react'

interface Agent { id: string; name: string }

interface ToolCall { tool: string; input: Record<string, unknown>; output: string; durationMs: number }

interface Message {
  role: 'user' | 'agent'
  content: string
  toolTrace?: ToolCall[]
  tokensUsed?: number
}

export default function PlaygroundPanel({
  workspaceId,
  agents,
  defaultAgentId,
}: {
  workspaceId: string
  agents: Agent[]
  defaultAgentId?: string
}) {
  const [selectedAgentId, setSelectedAgentId] = useState(defaultAgentId ?? agents[0]?.id ?? '')
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Stable contact ID for this session so conversation state persists across messages
  const contactIdRef = useRef(`playground-${Date.now()}`)

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!input.trim() || !selectedAgentId || loading) return

    const userMsg = input.trim()
    setInput('')
    setError('')
    const updatedMessages = [...messages, { role: 'user' as const, content: userMsg }]
    setMessages(updatedMessages)
    setLoading(true)

    // Build message history for context (exclude the message we just added)
    const history = messages.map(m => ({
      body: m.content,
      direction: m.role === 'user' ? 'inbound' : 'outbound',
    }))

    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/playground`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agentId: selectedAgentId,
          message: userMsg,
          contactId: contactIdRef.current,
          messageHistory: history,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)

      setMessages(prev => [...prev, {
        role: 'agent',
        content: data.reply ?? '(no reply sent)',
        toolTrace: data.toolCallTrace ?? [],
        tokensUsed: data.tokensUsed,
      }])
    } catch (err: any) {
      setError(err.message)
    }
    setLoading(false)
  }

  if (agents.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-800 p-12 text-center">
        <p className="text-zinc-400">No active agents. Create one first.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Agent selector */}
      <div>
        <label className="block text-xs text-zinc-500 mb-1.5">Agent</label>
        <select
          value={selectedAgentId}
          onChange={(e) => { setSelectedAgentId(e.target.value); setMessages([]); contactIdRef.current = `playground-${Date.now()}` }}
          className="bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-zinc-500"
        >
          {agents.map(a => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      </div>

      {/* Conversation */}
      {messages.length > 0 && (
        <div className="rounded-lg border border-zinc-800 p-4 space-y-4 max-h-[500px] overflow-y-auto">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} flex-col gap-2`}>
              <div className={`max-w-sm rounded-2xl px-4 py-3 ${
                msg.role === 'user'
                  ? 'bg-zinc-700 text-white rounded-tr-sm self-end'
                  : 'bg-zinc-900 border border-zinc-800 text-white rounded-tl-sm self-start'
              }`}>
                <p className="text-sm">{msg.content}</p>
                {msg.tokensUsed && (
                  <p className="text-xs text-zinc-500 mt-1">{msg.tokensUsed} tokens</p>
                )}
              </div>
              {msg.toolTrace && msg.toolTrace.length > 0 && (
                <div className="border border-zinc-800 rounded-lg overflow-hidden self-start max-w-md">
                  {msg.toolTrace.map((t, j) => (
                    <details key={j} className="group border-t border-zinc-800 first:border-t-0">
                      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none">
                        <span className="text-xs font-mono bg-zinc-800 text-zinc-300 px-1.5 py-0.5 rounded">{t.tool}</span>
                        <span className="text-xs text-zinc-600">{t.durationMs}ms</span>
                      </summary>
                      <div className="px-3 pb-2">
                        <pre className="text-xs bg-zinc-900 rounded p-2 overflow-x-auto text-zinc-400 max-h-24">{t.output}</pre>
                      </div>
                    </details>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl rounded-tl-sm px-4 py-3">
                <p className="text-sm text-zinc-500">Thinking…</p>
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Input */}
      <form onSubmit={sendMessage} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a test message…"
          disabled={loading}
          className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="inline-flex items-center justify-center rounded-lg bg-white text-black font-medium text-sm h-10 px-4 hover:bg-zinc-200 transition-colors disabled:opacity-50"
        >
          Send
        </button>
      </form>
      {messages.length > 0 && (
        <button
          onClick={() => { setMessages([]); contactIdRef.current = `playground-${Date.now()}` }}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Reset conversation
        </button>
      )}
    </div>
  )
}
