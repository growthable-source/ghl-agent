'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface Correction {
  id: string
  createdAt: string
  originalText: string
  correctedText: string
  reason: string | null
  correctedBy: string
  savedAsKnowledge?: boolean
  messageLog: {
    id: string
    createdAt: string
    contactId: string
    inboundMessage: string
    agent: { id: string; name: string } | null
  }
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

export default function CorrectionsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [corrections, setCorrections] = useState<Correction[]>([])
  const [notMigrated, setNotMigrated] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/corrections`)
      .then(r => r.json())
      .then(data => {
        setCorrections(data.corrections || [])
        setNotMigrated(!!data.notMigrated)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  if (loading) return <div className="flex-1 p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Corrections</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Messages where a human edited what the agent would have said. Each correction
            is stored as a training signal for improving future responses.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300 font-medium">Migration pending</p>
            <p className="text-xs text-amber-300/70 mt-1">
              Run manual_symbiosis_migration.sql to enable corrections tracking.
            </p>
          </div>
        )}

        {corrections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <div className="w-12 h-12 mb-3 rounded-full bg-zinc-800 flex items-center justify-center text-2xl">✎</div>
            <p className="text-sm font-medium text-white">No corrections yet</p>
            <p className="text-xs text-zinc-500 mt-1 max-w-md text-center">
              When you correct an agent reply from a conversation, it&apos;ll appear here so
              you can see what&apos;s changing over time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {corrections.map(c => (
              <div key={c.id} className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/40">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {c.messageLog.agent && (
                    <Link
                      href={`/dashboard/${workspaceId}/agents/${c.messageLog.agent.id}`}
                      className="text-sm font-semibold text-white hover:underline"
                    >
                      {c.messageLog.agent.name}
                    </Link>
                  )}
                  <Link
                    href={`/dashboard/${workspaceId}/contacts/${c.messageLog.contactId}`}
                    className="text-xs text-zinc-500 hover:text-zinc-300 font-mono"
                  >
                    {c.messageLog.contactId.slice(-8)}
                  </Link>
                  <span className="ml-auto text-xs text-zinc-500">{timeAgo(c.createdAt)}</span>
                </div>

                <div className="p-3 rounded-lg bg-zinc-900 mb-2">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">Contact said</p>
                  <p className="text-xs text-zinc-300">&ldquo;{c.messageLog.inboundMessage.slice(0, 200)}&rdquo;</p>
                </div>

                <div className="grid md:grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
                    <p className="text-[10px] text-red-400 uppercase tracking-wider mb-1">Original</p>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap line-through decoration-red-500/30 decoration-1">
                      {c.originalText}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                    <p className="text-[10px] text-emerald-400 uppercase tracking-wider mb-1">Corrected</p>
                    <p className="text-xs text-zinc-300 whitespace-pre-wrap">{c.correctedText}</p>
                  </div>
                </div>

                {c.reason && (
                  <p className="text-xs text-zinc-500 mt-3 pt-3 border-t border-zinc-800">
                    <span className="text-zinc-400">Reason:</span> {c.reason}
                  </p>
                )}

                <div className="mt-3 pt-3 border-t border-zinc-800 flex items-center justify-between">
                  {c.savedAsKnowledge ? (
                    <span className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                      ✓ Saved to knowledge base
                    </span>
                  ) : (
                    <button
                      onClick={async () => {
                        const title = prompt('Knowledge entry title:', c.messageLog.inboundMessage.slice(0, 60))
                        if (!title) return
                        const res = await fetch(`/api/workspaces/${workspaceId}/corrections/${c.id}/save-as-knowledge`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ title }),
                        })
                        if (res.ok) {
                          setCorrections(prev => prev.map(p => p.id === c.id ? { ...p, savedAsKnowledge: true } : p))
                        }
                      }}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-colors text-white"
                      style={{ background: '#fa4d2e' }}
                    >
                      + Save as knowledge entry
                    </button>
                  )}
                  <Link
                    href={`/dashboard/${workspaceId}/replay/${c.messageLog.id}`}
                    className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    View full conversation →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
