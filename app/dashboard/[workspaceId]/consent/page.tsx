'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

interface ConsentRecord {
  id: string
  contactId: string
  channel: string
  status: string
  source: string | null
  detail: string | null
  createdAt: string
  updatedAt: string
}

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  opted_in:  { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  label: 'Opted in' },
  opted_out: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  label: 'Opted out' },
  unknown:   { color: '#a1a1aa', bg: 'rgba(161,161,170,0.1)', label: 'Unknown' },
}

export default function ConsentPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [records, setRecords] = useState<ConsentRecord[]>([])
  const [summary, setSummary] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [notMigrated, setNotMigrated] = useState(false)

  useEffect(() => {
    const qs = filter !== 'all' ? `?status=${filter}` : ''
    fetch(`/api/workspaces/${workspaceId}/consent${qs}`)
      .then(r => r.json())
      .then(data => {
        setRecords(data.records || [])
        setSummary(data.summary || {})
        setNotMigrated(!!data.notMigrated)
      })
      .finally(() => setLoading(false))
  }, [workspaceId, filter])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Consent &amp; Compliance</h1>
          <p className="text-sm text-zinc-400 mt-1">
            TCPA and GDPR consent tracking per contact per channel. Required for SMS marketing at scale.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_symbiosis_wave2.sql to enable consent tracking.</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mb-6">
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setFilter(filter === key ? 'all' : key)}
              className={`p-4 rounded-xl border text-left transition-colors ${
                filter === key ? 'border-zinc-600 bg-zinc-900' : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
                <span className="text-xs text-zinc-500">{cfg.label}</span>
              </div>
              <p className="text-xl font-bold text-white">{summary[key] ?? 0}</p>
            </button>
          ))}
        </div>

        {records.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-zinc-700 rounded-xl bg-zinc-900/20">
            <p className="text-sm font-medium text-white mb-1">No consent records yet</p>
            <p className="text-xs text-zinc-500">
              Records appear automatically when a contact opts in or out (via keyword, webform, or API).
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {records.map(r => {
              const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.unknown
              return (
                <Link
                  key={r.id}
                  href={`/dashboard/${workspaceId}/contacts/${r.contactId}`}
                  className="flex items-center gap-3 p-3 rounded-lg border border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 transition-colors"
                >
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{ background: cfg.bg, color: cfg.color }}>
                    {cfg.label}
                  </span>
                  <span className="text-xs text-zinc-400 font-medium">{r.channel}</span>
                  <span className="text-xs text-zinc-300 font-mono flex-1 truncate">{r.contactId}</span>
                  {r.source && <span className="text-[10px] text-zinc-500">{r.source}</span>}
                  <span className="text-[10px] text-zinc-600">{new Date(r.updatedAt).toLocaleDateString()}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
