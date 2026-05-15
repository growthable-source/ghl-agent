'use client'

import { useState, useRef } from 'react'
import PlaygroundFeedback from './PlaygroundFeedback'

interface Agent { id: string; name: string }

interface ToolCall { tool: string; input: Record<string, unknown>; output: string; durationMs: number }

interface KnowledgeUsedItem {
  sourceUrl: string
  sourceType: string
  title: string
  preview: string
  similarity: number
  taxonomyTags: string[]
}

interface RetrievedChunkLite {
  id: string
  content: string
  sourceUrl: string
  primaryTopic: string | null
  similarity: number
  sourceMetadata: Record<string, unknown>
}

interface RetrievalDebug {
  topChunks: RetrievedChunkLite[]
  chunksInScope: number
  chunksInWorkspace: number
  chunksWithNullEmbedding: number
  topSimilarity: number | null
  thresholdForRuntime: number
  scopedDomainNames: string[]
  domainsInWorkspace: number
  reason:
    | 'good_match'
    | 'below_threshold'
    | 'empty_scope'
    | 'no_chunks_in_workspace'
    | 'embeddings_failed'
    | 'query_too_short'
    | 'embed_failed'
    | 'pgvector_missing'
    | 'query_failed'
  errorDetail: string | null
}

interface Message {
  role: 'user' | 'agent'
  content: string
  toolTrace?: ToolCall[]
  tokensUsed?: number
  knowledgeUsed?: KnowledgeUsedItem[]
  retrievalDebug?: RetrievalDebug | null
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
        knowledgeUsed: data.knowledgeUsed ?? [],
        retrievalDebug: data.retrievalDebug ?? null,
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
              {msg.role === 'agent' && msg.retrievalDebug !== undefined && msg.retrievalDebug !== null && (
                <div className="self-start max-w-md w-full">
                  <RetrievalDiagnostic debug={msg.retrievalDebug} />
                </div>
              )}
              {/* Thumbs feedback on each agent reply. Captures the full
                  conversation up to this point so the reviewer sees the
                  same context the agent replied to. Requires a selected
                  agent (which is always set when messages exist). */}
              {msg.role === 'agent' && selectedAgentId && (
                <div className="self-start max-w-md">
                  <PlaygroundFeedback
                    workspaceId={workspaceId}
                    agentId={selectedAgentId}
                    conversation={messages.slice(0, i + 1).map(m => ({ role: m.role, content: m.content }))}
                    flaggedReplyIndex={i}
                  />
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

/**
 * Always-visible diagnostic of what the retrieval did for the most
 * recent agent reply. Replaces the binary "matched/didn't" banner
 * with a categorical reason + counts + (when there are chunks but
 * none reached threshold) the top near-misses with their actual
 * similarity scores. Operators can finally see *why* an answer was
 * wrong instead of guessing.
 */
function RetrievalDiagnostic({ debug }: { debug: RetrievalDebug }) {
  const thresholdPct = Math.round(debug.thresholdForRuntime * 100)
  const topPct = debug.topSimilarity !== null ? Math.round(debug.topSimilarity * 100) : null
  const scopeLabel = debug.scopedDomainNames.length > 0
    ? `Scoped to ${debug.scopedDomainNames.length} of ${debug.domainsInWorkspace} collection${debug.domainsInWorkspace === 1 ? '' : 's'}: ${debug.scopedDomainNames.join(', ')}`
    : `Searching all ${debug.domainsInWorkspace} collection${debug.domainsInWorkspace === 1 ? '' : 's'} in this workspace`

  // Pick tone based on reason. Good = green, "below threshold but
  // close" = amber (recoverable — lower threshold or add content),
  // structural problems (empty scope, embeddings failed) = red.
  const tone: 'good' | 'warn' | 'bad' =
    debug.reason === 'good_match' ? 'good'
    : debug.reason === 'below_threshold' || debug.reason === 'query_too_short' ? 'warn'
    : 'bad'

  const colors = tone === 'good'
    ? { border: 'border-emerald-900/60', bg: 'bg-emerald-950/30', accent: 'text-emerald-300', subtle: 'text-emerald-500' }
    : tone === 'warn'
    ? { border: 'border-amber-900/60', bg: 'bg-amber-950/20', accent: 'text-amber-300', subtle: 'text-amber-500' }
    : { border: 'border-red-900/60', bg: 'bg-red-950/20', accent: 'text-red-300', subtle: 'text-red-500' }

  const usedChunks = tone === 'good' ? debug.topChunks.filter(c => c.similarity >= debug.thresholdForRuntime) : []
  const nearMisses = tone === 'warn' && debug.topChunks.length > 0 ? debug.topChunks.slice(0, 3) : []

  return (
    <details className={`border rounded-lg overflow-hidden ${colors.border} ${colors.bg}`}>
      <summary className="flex items-center gap-2 px-3 py-2 cursor-pointer list-none">
        <span>{tone === 'good' ? '📚' : tone === 'warn' ? '🔍' : '⚠️'}</span>
        <span className={`text-xs font-medium ${colors.accent}`}>
          {summaryLine(debug, topPct, thresholdPct, usedChunks.length)}
        </span>
        <span className={`text-[10px] ml-auto ${colors.subtle}`}>details ›</span>
      </summary>
      <div className="border-t border-zinc-800/50 px-3 py-2 space-y-1.5">
        <DiagRow label="Reason">
          <span className={colors.accent}>{reasonExplanation(debug)}</span>
        </DiagRow>
        <DiagRow label="Scope">
          <span className="text-zinc-400">{scopeLabel}</span>
        </DiagRow>
        <DiagRow label="Indexed in this scope">
          <span className="text-zinc-400">
            {debug.chunksInScope.toLocaleString()} chunk{debug.chunksInScope === 1 ? '' : 's'}
            {debug.chunksInScope !== debug.chunksInWorkspace && (
              <> · ({debug.chunksInWorkspace.toLocaleString()} workspace-wide)</>
            )}
          </span>
        </DiagRow>
        {debug.chunksWithNullEmbedding > 0 && (
          <DiagRow label="⚠️ Failed to embed">
            <span className="text-red-400">{debug.chunksWithNullEmbedding.toLocaleString()} chunks — re-run that source</span>
          </DiagRow>
        )}
        {debug.topSimilarity !== null && (
          <DiagRow label="Top match">
            <span className="text-zinc-400">{topPct}% (cutoff {thresholdPct}%)</span>
          </DiagRow>
        )}
        {debug.errorDetail && (
          <DiagRow label="Error detail">
            <code className="text-[10px] break-all" style={{ color: 'var(--accent-red)' }}>{debug.errorDetail}</code>
          </DiagRow>
        )}
      </div>

      {usedChunks.length > 0 && (
        <div className="border-t border-emerald-900/40">
          <p className="text-[10px] uppercase tracking-wider font-semibold px-3 pt-2 text-emerald-500">Passages the agent saw</p>
          {usedChunks.map((k, j) => (
            <DiagChunk key={j} chunk={k} accent="emerald" />
          ))}
        </div>
      )}

      {nearMisses.length > 0 && (
        <div className="border-t border-amber-900/40">
          <p className="text-[10px] uppercase tracking-wider font-semibold px-3 pt-2 text-amber-500">Closest matches (didn&apos;t make the cutoff)</p>
          {nearMisses.map((k, j) => (
            <DiagChunk key={j} chunk={k} accent="amber" />
          ))}
          <p className="text-[10px] px-3 py-2 text-amber-500/80">
            Tip: if these look correct, the cutoff is too tight. Lower it on the agent&apos;s Knowledge tab.
          </p>
        </div>
      )}
    </details>
  )
}

function summaryLine(d: RetrievalDebug, topPct: number | null, thresholdPct: number, usedCount: number): string {
  switch (d.reason) {
    case 'good_match':
      return `Read ${usedCount} passage${usedCount === 1 ? '' : 's'} (top match ${topPct}%)`
    case 'below_threshold':
      return `Best match was ${topPct}% — below the ${thresholdPct}% cutoff`
    case 'empty_scope':
      return `This agent is scoped to collections with 0 indexed content`
    case 'no_chunks_in_workspace':
      return `No content indexed yet in this workspace`
    case 'embeddings_failed':
      return `Embeddings failed for every chunk — re-ingest the source`
    case 'query_too_short':
      return `Question too short to search`
    case 'embed_failed':
      return `Couldn't embed your question (Voyage API issue)`
    case 'pgvector_missing':
      return `pgvector extension isn't enabled on this database`
    case 'query_failed':
      return `Database query failed — see details`
  }
}

function reasonExplanation(d: RetrievalDebug): string {
  switch (d.reason) {
    case 'good_match':
      return 'Found relevant content. Agent answered using the passages below.'
    case 'below_threshold':
      return `Chunks exist and rank by relevance, but none scored above ${Math.round(d.thresholdForRuntime * 100)}%. The agent answered without retrieval.`
    case 'empty_scope':
      return `${d.chunksInWorkspace.toLocaleString()} chunks exist in this workspace, but this agent is scoped to collections that contain none. Fix on the agent's Knowledge tab.`
    case 'no_chunks_in_workspace':
      return 'No ingested sources have any chunks yet. Go to Knowledge → Sources and run "Read now" on a source.'
    case 'embeddings_failed':
      return `Every chunk in this workspace has a NULL embedding — the ingest succeeded but Voyage embedding failed silently. Check VOYAGE_API_KEY and re-run the source.`
    case 'query_too_short':
      return 'Question needs to be at least 3 characters to retrieve.'
    case 'embed_failed':
      return 'The query embed call failed — usually a Voyage API key or rate-limit issue. Check the diagnostic on the Knowledge page.'
    case 'pgvector_missing':
      return 'The `vector` Postgres extension isn\'t installed on this database. Fix: open Supabase → Database → Extensions → enable "vector" (or run `CREATE EXTENSION vector;` in the SQL editor as a superuser). Then re-ingest any source that was attempted before the fix.'
    case 'query_failed':
      return 'The pgvector query threw. Check the error detail below — common causes: embedding dimension mismatch (different model used at some point), corrupted vector column, or an unrelated Postgres-level error.'
  }
}

function DiagRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-[11px]">
      <span className="text-zinc-500 shrink-0 w-32">{label}</span>
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  )
}

function DiagChunk({ chunk, accent }: { chunk: RetrievedChunkLite; accent: 'emerald' | 'amber' }) {
  const title = (chunk.sourceMetadata?.page_title as string) || chunk.primaryTopic || '(untitled)'
  const titleColor = accent === 'emerald' ? 'text-emerald-200' : 'text-amber-200'
  const linkColor = accent === 'emerald' ? 'text-emerald-500 hover:text-emerald-400' : 'text-amber-500 hover:text-amber-400'
  const scoreColor = accent === 'emerald' ? 'text-emerald-600' : 'text-amber-600'
  return (
    <div className="px-3 py-2 border-t border-zinc-800/30 first:border-t-0">
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-xs font-semibold ${titleColor}`}>{title}</span>
        <span className={`text-[10px] ml-auto ${scoreColor}`}>{Math.round(chunk.similarity * 100)}%</span>
      </div>
      <p className="text-[11px] text-zinc-400 line-clamp-2 mb-1">
        {chunk.content.replace(/\s+/g, ' ').slice(0, 200)}
      </p>
      <a
        href={chunk.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className={`text-[10px] truncate block ${linkColor}`}
      >
        {chunk.sourceUrl}
      </a>
    </div>
  )
}
