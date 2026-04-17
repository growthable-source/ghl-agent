'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface PromptVersion {
  id: string
  systemPrompt: string
  instructions: string | null
  changeNote: string | null
  editedBy: string
  isRollback: boolean
  createdAt: string
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// Simple line-level diff
function diffLines(a: string, b: string): Array<{ line: string; type: 'same' | 'add' | 'remove' }> {
  const aLines = a.split('\n')
  const bLines = b.split('\n')
  const max = Math.max(aLines.length, bLines.length)
  const result: Array<{ line: string; type: 'same' | 'add' | 'remove' }> = []
  for (let i = 0; i < max; i++) {
    const aLine = aLines[i]
    const bLine = bLines[i]
    if (aLine === bLine) {
      if (aLine !== undefined) result.push({ line: aLine, type: 'same' })
    } else {
      if (aLine !== undefined) result.push({ line: aLine, type: 'remove' })
      if (bLine !== undefined) result.push({ line: bLine, type: 'add' })
    }
  }
  return result
}

export default function PromptVersionsPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const agentId = params.agentId as string
  const [versions, setVersions] = useState<PromptVersion[]>([])
  const [current, setCurrent] = useState<{ systemPrompt: string; instructions: string | null; name: string } | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rollingBack, setRollingBack] = useState(false)
  const [notMigrated, setNotMigrated] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/prompt-versions`).then(r => r.json()),
      fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`).then(r => r.json()),
    ]).then(([vdata, adata]) => {
      setVersions(vdata.versions || [])
      setNotMigrated(!!vdata.notMigrated)
      if (adata.agent) {
        setCurrent({
          systemPrompt: adata.agent.systemPrompt || '',
          instructions: adata.agent.instructions,
          name: adata.agent.name,
        })
      }
    }).finally(() => setLoading(false))
  }, [workspaceId, agentId])

  const selected = versions.find(v => v.id === selectedId)

  async function rollback(v: PromptVersion) {
    if (!confirm(`Rollback to this version from ${timeAgo(v.createdAt)}? The current prompt will be replaced.`)) return
    setRollingBack(true)
    try {
      // Save the current prompt as a new version first (safety snapshot)
      if (current) {
        await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/prompt-versions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemPrompt: current.systemPrompt,
            instructions: current.instructions,
            changeNote: 'Auto-snapshot before rollback',
          }),
        })
      }
      // Apply the old version as current
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: v.systemPrompt,
          instructions: v.instructions,
        }),
      })
      // Save as new version marked as rollback
      await fetch(`/api/workspaces/${workspaceId}/agents/${agentId}/prompt-versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemPrompt: v.systemPrompt,
          instructions: v.instructions,
          changeNote: `Rolled back to version from ${new Date(v.createdAt).toLocaleString()}`,
          isRollback: true,
        }),
      })
      router.push(`/dashboard/${workspaceId}/agents/${agentId}`)
    } finally { setRollingBack(false) }
  }

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <Link href={`/dashboard/${workspaceId}/agents/${agentId}`} className="text-xs text-zinc-500 hover:text-zinc-300 mb-4 inline-block">
          ← Back to {current?.name}
        </Link>
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Prompt History</h1>
          <p className="text-sm text-zinc-400 mt-1">Every change to this agent&apos;s system prompt, with diff and rollback.</p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-medium">Migration pending</p>
            <p className="text-xs text-amber-300/70 mt-1">Run manual_symbiosis_wave2.sql to enable prompt versioning.</p>
          </div>
        )}

        <div className="grid grid-cols-[260px_1fr] gap-6">
          {/* Version list */}
          <div className="space-y-1">
            <div className="p-3 rounded-lg border border-orange-500/40 bg-orange-500/5">
              <p className="text-[10px] uppercase tracking-wider text-orange-400 font-semibold mb-0.5">Current</p>
              <p className="text-xs text-white">Live prompt</p>
            </div>
            {versions.length === 0 ? (
              <p className="text-xs text-zinc-500 p-3">No prior versions yet</p>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left p-3 rounded-lg transition-colors ${
                    selectedId === v.id
                      ? 'bg-zinc-800 border border-zinc-600'
                      : 'border border-zinc-800 hover:bg-zinc-900/40'
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    {v.isRollback && (
                      <span className="text-[9px] font-bold text-amber-400 px-1 py-0.5 rounded bg-amber-500/10">ROLLBACK</span>
                    )}
                    <p className="text-xs text-white">{timeAgo(v.createdAt)}</p>
                  </div>
                  {v.changeNote && (
                    <p className="text-[10px] text-zinc-500 line-clamp-2">{v.changeNote}</p>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Diff viewer */}
          <div>
            {selected && current ? (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-sm font-semibold text-white">
                      Comparing current → version from {timeAgo(selected.createdAt)}
                    </p>
                    {selected.changeNote && (
                      <p className="text-xs text-zinc-500 mt-1">{selected.changeNote}</p>
                    )}
                  </div>
                  <button
                    onClick={() => rollback(selected)}
                    disabled={rollingBack}
                    className="text-xs font-semibold px-3 py-2 rounded-lg text-white hover:opacity-90 transition-colors disabled:opacity-50"
                    style={{ background: '#fa4d2e' }}
                  >
                    {rollingBack ? 'Rolling back...' : 'Restore this version'}
                  </button>
                </div>

                <div className="rounded-xl border border-zinc-800 overflow-hidden">
                  <div className="bg-zinc-900 px-4 py-2 border-b border-zinc-800">
                    <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">System prompt diff</p>
                  </div>
                  <div className="bg-zinc-950 p-4 font-mono text-xs overflow-x-auto">
                    {diffLines(current.systemPrompt, selected.systemPrompt).map((d, i) => (
                      <div
                        key={i}
                        className={`whitespace-pre-wrap ${
                          d.type === 'add' ? 'bg-emerald-500/10 text-emerald-300 pl-2'
                          : d.type === 'remove' ? 'bg-red-500/10 text-red-300 line-through pl-2'
                          : 'text-zinc-400'
                        }`}
                      >
                        {d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  '}{d.line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-8 rounded-xl border border-dashed border-zinc-700 text-center text-sm text-zinc-500">
                Select a version from the left to view the diff
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
