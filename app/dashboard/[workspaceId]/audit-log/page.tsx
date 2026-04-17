'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

interface AuditEntry {
  id: string
  action: string
  actorId: string
  actor: { id: string; name: string | null; email: string | null } | null
  targetType: string | null
  targetId: string | null
  metadata: any
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

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  'agent.prompt.edit':       { label: 'Edited prompt',        color: '#60a5fa' },
  'agent.prompt.rollback':   { label: 'Rolled back prompt',   color: '#fbbf24' },
  'agent.paused':            { label: 'Paused agent',         color: '#f87171' },
  'agent.resumed':           { label: 'Resumed agent',        color: '#4ade80' },
  'conversation.takeover.start': { label: 'Took over',        color: '#fb923c' },
  'conversation.takeover.end':   { label: 'Released',         color: '#4ade80' },
  'message.approved':        { label: 'Approved message',     color: '#22c55e' },
  'message.rejected':        { label: 'Rejected message',     color: '#ef4444' },
  'workspace.pause':         { label: 'Paused workspace',     color: '#f87171' },
  'workspace.resume':        { label: 'Resumed workspace',    color: '#4ade80' },
}

export default function AuditLogPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [notMigrated, setNotMigrated] = useState(false)

  useEffect(() => {
    fetch(`/api/workspaces/${workspaceId}/audit-log`)
      .then(r => r.json())
      .then(data => {
        setLogs(data.logs || [])
        setNotMigrated(!!data.notMigrated)
      })
      .finally(() => setLoading(false))
  }, [workspaceId])

  if (loading) return <div className="p-8"><div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" /></div>

  return (
    <div className="flex-1 p-8 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Audit Log</h1>
          <p className="text-sm text-zinc-400 mt-1">
            Every human action in this workspace — who did what, when.
          </p>
        </div>

        {notMigrated && (
          <div className="p-4 mb-6 rounded-xl border border-amber-500/30 bg-amber-500/5">
            <p className="text-sm text-amber-300">Run manual_symbiosis_wave2.sql to enable audit logging.</p>
          </div>
        )}

        {logs.length === 0 ? (
          <div className="text-center py-16 text-sm text-zinc-500">No auditable actions yet</div>
        ) : (
          <div className="relative">
            <div className="absolute left-[13px] top-3 bottom-3 w-px bg-zinc-800" />
            <div className="space-y-1">
              {logs.map(log => {
                const info = ACTION_LABELS[log.action] || { label: log.action, color: '#a1a1aa' }
                return (
                  <div key={log.id} className="relative flex items-start gap-3 p-2 rounded-lg hover:bg-zinc-900/40 transition-colors">
                    <div className="relative z-10 flex-shrink-0 w-7 h-7 rounded-full bg-zinc-900 border border-zinc-700 flex items-center justify-center text-[10px]" style={{ color: info.color }}>
                      ●
                    </div>
                    <div className="flex-1 min-w-0 pt-1">
                      <div className="flex items-center gap-2 flex-wrap text-xs">
                        <span className="font-semibold text-white">
                          {log.actor?.name || log.actor?.email || log.actorId.slice(-6)}
                        </span>
                        <span style={{ color: info.color }}>{info.label}</span>
                        {log.targetType && (
                          <span className="text-[10px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800 font-mono">
                            {log.targetType}{log.targetId ? ` · ${log.targetId.slice(-6)}` : ''}
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-zinc-600">{timeAgo(log.createdAt)}</span>
                      </div>
                      {log.metadata && Object.keys(log.metadata).length > 0 && (
                        <p className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">
                          {JSON.stringify(log.metadata)}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
