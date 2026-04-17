'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Message {
  id: string
  role: string
  content: string
  createdAt: string
}

export default function ReplayPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const messageLogId = params.messageLogId as string

  const [conversation, setConversation] = useState<Message[]>([])
  const [agent, setAgent] = useState<{ id: string; name: string; systemPrompt: string } | null>(null)
  const [anchor, setAnchor] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [scrubIndex, setScrubIndex] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/replay/${messageLogId}`)
      .then(r => r.json())
      .then(data => {
        setConversation(data.conversation || [])
        setAgent(data.agent)
        setAnchor(data.anchor)
        setScrubIndex((data.conversation?.length || 1) - 1)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, messageLogId])

  // Playback: auto-advance scrubIndex
  useEffect(() => {
    if (!playing) return
    if (scrubIndex >= conversation.length - 1) {
      setPlaying(false)
      return
    }
    const t = setTimeout(() => setScrubIndex(i => i + 1), 1200)
    return () => clearTimeout(t)
  }, [playing, scrubIndex, conversation.length])

  const visibleMessages = useMemo(() => conversation.slice(0, scrubIndex + 1), [conversation, scrubIndex])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-3xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/conversations`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
          ← Back to conversations
        </Link>

        <div className="mb-6">
          <h1 className="text-2xl font-bold text-white">Conversation Replay</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {agent && <>Agent: <Link href={`/dashboard/${workspaceId}/agents/${agent.id}`} className="text-zinc-300 hover:underline">{agent.name}</Link> · </>}
            Contact <span className="font-mono">{anchor?.contactId?.slice(-8)}</span>
          </p>
        </div>

        {/* Scrubber */}
        {conversation.length > 0 && (
          <div className="mb-6 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => setPlaying(!playing)}
                className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-white hover:opacity-90 transition-colors"
                style={{ background: '#fa4d2e' }}
              >
                {playing ? (
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(0, conversation.length - 1)}
                value={scrubIndex}
                onChange={e => { setPlaying(false); setScrubIndex(parseInt(e.target.value)) }}
                className="flex-1 accent-orange-500"
              />
              <span className="text-xs text-zinc-500 flex-shrink-0">
                {scrubIndex + 1} / {conversation.length}
              </span>
            </div>
            <p className="text-xs text-zinc-500">
              Drag or press play to replay the conversation message by message.
            </p>
          </div>
        )}

        {/* Conversation */}
        <div className="space-y-3">
          {visibleMessages.length === 0 ? (
            <p className="text-center text-sm text-zinc-500 py-12">No messages in this conversation</p>
          ) : (
            visibleMessages.map((msg, i) => {
              const isLast = i === visibleMessages.length - 1
              const isUser = msg.role === 'user'
              return (
                <div
                  key={msg.id}
                  className={`flex ${isUser ? 'justify-start' : 'justify-end'} ${isLast && playing ? 'animate-in fade-in slide-in-from-bottom-2' : ''}`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-2xl ${
                      isUser
                        ? 'bg-zinc-800 text-zinc-200 rounded-tl-sm'
                        : 'bg-orange-500/20 text-zinc-200 rounded-tr-sm border border-orange-500/30'
                    }`}
                  >
                    <p className="text-xs whitespace-pre-wrap">{msg.content}</p>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      {new Date(msg.createdAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {agent && (
          <div className="mt-8 p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Agent system prompt at replay time</p>
            <p className="text-xs text-zinc-400 whitespace-pre-wrap line-clamp-6 font-mono">{agent.systemPrompt}</p>
            <Link
              href={`/dashboard/${workspaceId}/agents/${agent.id}/prompt-versions`}
              className="text-[11px] text-orange-400 hover:underline mt-2 inline-block"
            >
              See prompt history →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
