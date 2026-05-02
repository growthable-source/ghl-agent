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

  if (loading) return <div className="flex-1 p-8"><div className="h-8 w-48 rounded animate-pulse" style={{ background: 'var(--surface-tertiary)' }} /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Corrections</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
            Messages where a human edited what the agent would have said. Each correction
            is stored as a training signal for improving future responses.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl" style={{ background: 'var(--accent-amber-bg)', border: '1px solid var(--accent-amber-bg)' }}>
            <p className="text-sm font-medium" style={{ color: 'var(--accent-amber)' }}>Migration pending</p>
            <p className="text-xs mt-1" style={{ color: 'var(--accent-amber)' }}>
              Run manual_symbiosis_migration.sql to enable corrections tracking.
            </p>
          </div>
        )}

        {corrections.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 rounded-xl" style={{ border: '1px dashed var(--border-secondary)', background: 'var(--surface-secondary)' }}>
            <div className="w-12 h-12 mb-3 rounded-full flex items-center justify-center text-2xl" style={{ background: 'var(--surface-tertiary)' }}>✎</div>
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No corrections yet</p>
            <p className="text-xs mt-1 max-w-md text-center" style={{ color: 'var(--text-muted)' }}>
              When you correct an agent reply from a conversation, it&apos;ll appear here so
              you can see what&apos;s changing over time.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {corrections.map(c => (
              <div key={c.id} className="p-4 rounded-xl" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {c.messageLog.agent && (
                    <Link
                      href={`/dashboard/${workspaceId}/agents/${c.messageLog.agent.id}`}
                      className="text-sm font-semibold hover:underline"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {c.messageLog.agent.name}
                    </Link>
                  )}
                  <Link
                    href={`/dashboard/${workspaceId}/contacts/${c.messageLog.contactId}`}
                    className="text-xs font-mono"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {c.messageLog.contactId.slice(-8)}
                  </Link>
                  <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{timeAgo(c.createdAt)}</span>
                </div>

                <div className="p-3 rounded-lg mb-2" style={{ background: 'var(--surface-tertiary)' }}>
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Contact said</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>&ldquo;{c.messageLog.inboundMessage.slice(0, 200)}&rdquo;</p>
                </div>

                <div className="grid md:grid-cols-2 gap-2">
                  <div className="p-3 rounded-lg" style={{ background: 'var(--accent-red-bg)', border: '1px solid var(--accent-red-bg)' }}>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--accent-red)' }}>Original</p>
                    <p className="text-xs whitespace-pre-wrap line-through decoration-red-500/30 decoration-1" style={{ color: 'var(--text-secondary)' }}>
                      {c.originalText}
                    </p>
                  </div>
                  <div className="p-3 rounded-lg" style={{ background: 'var(--accent-emerald-bg)', border: '1px solid var(--accent-emerald-bg)' }}>
                    <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--accent-emerald)' }}>Corrected</p>
                    <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>{c.correctedText}</p>
                  </div>
                </div>

                {c.reason && (
                  <p className="text-xs mt-3 pt-3" style={{ color: 'var(--text-muted)', borderTop: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-tertiary)' }}>Reason:</span> {c.reason}
                  </p>
                )}

                <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
                  {c.savedAsKnowledge ? (
                    <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: 'var(--accent-emerald)' }}>
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
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg hover:opacity-90 transition-colors"
                      style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
                    >
                      + Save as knowledge entry
                    </button>
                  )}
                  <Link
                    href={`/dashboard/${workspaceId}/replay/${c.messageLog.id}`}
                    className="text-[11px] transition-colors"
                    style={{ color: 'var(--text-muted)' }}
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
