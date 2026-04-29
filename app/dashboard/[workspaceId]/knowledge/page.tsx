'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'

interface Entry {
  id: string
  title: string
  content: string
  source: string
  sourceUrl: string | null
  status: string
  tokenEstimate: number
  createdAt: string
  updatedAt: string
  createdByAgent: { id: string; name: string } | null
  connectedAgentCount: number
  connectedAgentIds: string[]
}

interface AgentLite {
  id: string
  name: string
}

function relTime(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function sourceLabel(source: string): string {
  switch (source) {
    case 'manual':     return 'Written'
    case 'qa':         return 'Q&A'
    case 'notion':     return 'Notion'
    case 'youtube':    return 'YouTube'
    case 'url':        return 'Web'
    case 'file':       return 'File'
    case 'correction': return 'Correction'
    default:           return source
  }
}

export default function WorkspaceKnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [entries, setEntries] = useState<Entry[]>([])
  const [agents, setAgents] = useState<AgentLite[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)
  const [search, setSearch] = useState('')
  const [filterAgentId, setFilterAgentId] = useState<string>('')
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit'; entry?: Entry } | null>(null)

  const fetchAll = useCallback(async () => {
    const [eRes, aRes] = await Promise.all([
      fetch(`/api/workspaces/${workspaceId}/knowledge`),
      fetch(`/api/workspaces/${workspaceId}/agents`),
    ])
    const eData = await eRes.json()
    const aData = await aRes.json()
    setEntries(eData.entries || [])
    setNotMigrated(!!eData.notMigrated)
    setAgents((aData.agents || []).map((a: any) => ({ id: a.id, name: a.name })))
    setLoading(false)
  }, [workspaceId])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = useMemo(() => {
    let f = entries
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      f = f.filter(e =>
        e.title.toLowerCase().includes(q)
        || e.content.toLowerCase().includes(q)
        || (e.sourceUrl || '').toLowerCase().includes(q),
      )
    }
    if (filterAgentId) {
      if (filterAgentId === '__unconnected__') {
        f = f.filter(e => e.connectedAgentCount === 0)
      } else {
        f = f.filter(e => e.connectedAgentIds.includes(filterAgentId))
      }
    }
    return f
  }, [entries, search, filterAgentId])

  async function handleDelete(id: string) {
    if (!confirm('Delete this knowledge entry? This removes it from every agent it is connected to.')) return
    await fetch(`/api/workspaces/${workspaceId}/knowledge/${id}`, { method: 'DELETE' })
    fetchAll()
  }

  if (loading) return (
    <div className="flex-1 p-8">
      <div className="max-w-5xl mx-auto space-y-3">
        <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
        <div className="h-32 bg-zinc-900/40 rounded-xl border border-zinc-800 animate-pulse" />
      </div>
    </div>
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto p-8">
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Knowledge</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Write once, stack on as many agents as you want. Edits propagate to every connected agent.
            </p>
          </div>
          <button
            onClick={() => setEditor({ mode: 'create' })}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors"
          >
            + New entry
          </button>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-semibold">Migration pending</p>
            <p className="text-xs text-amber-300/80 mt-1">
              Run <code className="bg-black/30 px-1 rounded">prisma/migrations/20260429140000_workspace_knowledge/migration.sql</code> to enable workspace-level knowledge.
            </p>
          </div>
        )}

        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search title, content, URL\u2026"
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-600"
            />
            <svg className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
          <select
            value={filterAgentId}
            onChange={e => setFilterAgentId(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-zinc-600"
          >
            <option value="">Connected to any agent</option>
            <option value="__unconnected__">— Not connected to any agent —</option>
            {agents.map(a => <option key={a.id} value={a.id}>Connected to: {a.name}</option>)}
          </select>
          <div className="ml-auto text-[11px] text-zinc-500">
            {filtered.length} of {entries.length}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">📚</div>
            <p className="text-sm font-medium text-white mb-1">
              {search.trim() || filterAgentId ? 'No matches' : 'No knowledge yet'}
            </p>
            <p className="text-xs text-zinc-500">
              {search.trim() || filterAgentId
                ? 'Try a different search or filter.'
                : 'Add your first entry — FAQs, policies, product info — and connect it to one or more agents.'}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-zinc-800 divide-y divide-zinc-800 overflow-hidden bg-zinc-950">
            {filtered.map(e => (
              <div key={e.id} className="p-4 hover:bg-zinc-900/40 transition-colors">
                <div className="flex items-start justify-between gap-3 mb-2 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-sm font-semibold text-white truncate">{e.title}</h3>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">{sourceLabel(e.source)}</span>
                      {e.status !== 'ready' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{e.status}</span>
                      )}
                      {e.connectedAgentCount === 0 ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-dashed border-zinc-700 text-zinc-500">
                          unconnected
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300">
                          on {e.connectedAgentCount} agent{e.connectedAgentCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400 line-clamp-2 whitespace-pre-wrap">{e.content}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-zinc-600 flex-wrap">
                      <span>~{e.tokenEstimate} tokens</span>
                      <span>· updated {relTime(e.updatedAt)}</span>
                      {e.createdByAgent && (
                        <span className="px-1 py-0.5 rounded bg-zinc-900 border border-zinc-800">
                          created from {e.createdByAgent.name}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      onClick={() => setEditor({ mode: 'edit', entry: e })}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-zinc-800 text-red-400 hover:text-red-300 hover:border-red-500/40 transition-colors"
                      title="Delete entry permanently"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editor && (
        <KnowledgeEditor
          workspaceId={workspaceId}
          agents={agents}
          mode={editor.mode}
          entry={editor.entry}
          onClose={() => setEditor(null)}
          onSaved={() => { setEditor(null); fetchAll() }}
        />
      )}
    </div>
  )
}

function KnowledgeEditor({
  workspaceId, agents, mode, entry, onClose, onSaved,
}: {
  workspaceId: string
  agents: AgentLite[]
  mode: 'create' | 'edit'
  entry?: Entry
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [content, setContent] = useState(entry?.content ?? '')
  const [connectedIds, setConnectedIds] = useState<string[]>(entry?.connectedAgentIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggleAgent(id: string) {
    setConnectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function save() {
    setError(null)
    if (!title.trim()) { setError('Title is required.'); return }
    if (!content.trim()) { setError('Content is required.'); return }
    setSaving(true)
    try {
      if (mode === 'create') {
        const res = await fetch(`/api/workspaces/${workspaceId}/knowledge`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content, connectToAgentIds: connectedIds }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setError(d.error || 'Save failed'); return
        }
      } else if (entry) {
        const res = await fetch(`/api/workspaces/${workspaceId}/knowledge/${entry.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content }),
        })
        if (!res.ok) {
          const d = await res.json().catch(() => ({}))
          setError(d.error || 'Save failed'); return
        }
        // PUT connections (idempotent: replace full set).
        await fetch(`/api/workspaces/${workspaceId}/knowledge/${entry.id}/connections`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentIds: connectedIds }),
        })
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-white">
            {mode === 'create' ? 'New knowledge entry' : 'Edit entry'}
          </h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-white">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Refund policy"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">Content</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="What do you want every connected agent to know?"
              rows={10}
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-zinc-500 resize-y"
            />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold block mb-1.5">
              Stack on agents
              <span className="ml-2 text-zinc-600 normal-case font-normal tracking-normal">
                {connectedIds.length === 0
                  ? 'Not connected to any agent yet — entry will sit in the workspace pool.'
                  : `${connectedIds.length} agent${connectedIds.length === 1 ? '' : 's'} will use this.`}
              </span>
            </label>
            {agents.length === 0 ? (
              <p className="text-xs text-zinc-500 italic">No agents yet — create one first.</p>
            ) : (
              <div className="border border-zinc-800 rounded-lg max-h-48 overflow-y-auto bg-zinc-900">
                {agents.map(a => {
                  const checked = connectedIds.includes(a.id)
                  return (
                    <label key={a.id} className="flex items-center gap-2 px-3 py-2 hover:bg-zinc-800 cursor-pointer border-b border-zinc-800 last:border-b-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleAgent(a.id)}
                        className="accent-orange-500"
                      />
                      <span className="text-sm text-zinc-200">{a.name}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>
        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-semibold hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
