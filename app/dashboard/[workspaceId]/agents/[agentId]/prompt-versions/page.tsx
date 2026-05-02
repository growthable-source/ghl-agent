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

  if (loading) return <div className="p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-6xl mx-auto">
        <Link
          href={`/dashboard/${workspaceId}/agents/${agentId}`}
          className="text-xs mb-4 inline-block hover:opacity-80 transition-colors"
          style={{ color: 'var(--text-tertiary)' }}
        >
          ← Back to {current?.name}
        </Link>
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Prompt History</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>Every change to this agent&apos;s system prompt, with diff and rollback.</p>
        </div>

        {notMigrated && (
          <div
            className="p-4 mb-6 rounded-xl border"
            style={{ borderColor: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
          >
            <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
            <p className="text-xs mt-1" style={{ color: 'var(--accent-amber)' }}>Run manual_symbiosis_wave2.sql to enable prompt versioning.</p>
          </div>
        )}

        <div className="grid grid-cols-[260px_1fr] gap-6">
          {/* Version list */}
          <div className="space-y-1">
            <div
              className="p-3 rounded-lg border"
              style={{ borderColor: 'var(--accent-primary)', background: 'var(--accent-primary-bg)' }}
            >
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-0.5" style={{ color: 'var(--accent-primary)' }}>Current</p>
              <p className="text-xs" style={{ color: 'var(--text-primary)' }}>Live prompt</p>
            </div>
            {versions.length === 0 ? (
              <p className="text-xs p-3" style={{ color: 'var(--text-tertiary)' }}>No prior versions yet</p>
            ) : (
              versions.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className="w-full text-left p-3 rounded-lg transition-colors border"
                  style={selectedId === v.id
                    ? { background: 'var(--surface-tertiary)', borderColor: 'var(--border-secondary)' }
                    : { background: 'transparent', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center gap-1 mb-1">
                    {v.isRollback && (
                      <span
                        className="text-[9px] font-bold px-1 py-0.5 rounded"
                        style={{ color: 'var(--accent-amber)', background: 'var(--accent-amber-bg)' }}
                      >ROLLBACK</span>
                    )}
                    <p className="text-xs" style={{ color: 'var(--text-primary)' }}>{timeAgo(v.createdAt)}</p>
                  </div>
                  {v.changeNote && (
                    <p className="text-[10px] line-clamp-2" style={{ color: 'var(--text-tertiary)' }}>{v.changeNote}</p>
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
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                      Comparing current → version from {timeAgo(selected.createdAt)}
                    </p>
                    {selected.changeNote && (
                      <p className="text-xs mt-1" style={{ color: 'var(--text-tertiary)' }}>{selected.changeNote}</p>
                    )}
                  </div>
                  <button
                    onClick={() => rollback(selected)}
                    disabled={rollingBack}
                    className="text-xs font-semibold px-3 py-2 rounded-lg hover:opacity-90 transition-colors disabled:opacity-50"
                    style={{ background: 'var(--accent-primary)', color: '#fff' }}
                  >
                    {rollingBack ? 'Rolling back...' : 'Restore this version'}
                  </button>
                </div>

                <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <div
                    className="px-4 py-2 border-b"
                    style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
                  >
                    <p className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-tertiary)' }}>System prompt diff</p>
                  </div>
                  <div className="p-4 font-mono text-xs overflow-x-auto" style={{ background: 'var(--surface)' }}>
                    {diffLines(current.systemPrompt, selected.systemPrompt).map((d, i) => (
                      <div
                        key={i}
                        className={`whitespace-pre-wrap ${d.type === 'remove' ? 'line-through' : ''} ${d.type !== 'same' ? 'pl-2' : ''}`}
                        style={
                          d.type === 'add' ? { background: 'var(--accent-emerald-bg)', color: 'var(--accent-emerald)' }
                          : d.type === 'remove' ? { background: 'var(--accent-red-bg)', color: 'var(--accent-red)' }
                          : { color: 'var(--text-secondary)' }
                        }
                      >
                        {d.type === 'add' ? '+ ' : d.type === 'remove' ? '- ' : '  '}{d.line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="p-8 rounded-xl border border-dashed text-center text-sm"
                style={{ borderColor: 'var(--border-secondary)', color: 'var(--text-tertiary)' }}
              >
                Select a version from the left to view the diff
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
