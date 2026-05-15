'use client'

/**
 * CRM-side context for the conversation: linked contact, open
 * opportunities, recent notes, open tasks. Only renders when the
 * workspace is connected to a CRM AND the visitor has a CRM contact
 * id resolved (the widget identify flow sets that on first email).
 */

import { useEffect, useState } from 'react'
import { relTime } from './conversation-helpers'

interface CrmContext {
  connected: boolean
  reason?: string
  provider?: string
  deepLink?: string | null
  contact?: {
    id: string
    name?: string | null
    email?: string | null
    phone?: string | null
    tags?: string[]
    source?: string | null
    dateAdded?: string | null
  } | null
  opportunities: Array<{ id: string; name: string; stage?: string | null; monetaryValue?: number | null; status?: string | null }>
  notes: Array<{ id: string; body: string; dateAdded?: string | null }>
  tasks: Array<{ id: string; title: string; dueDate?: string | null; completed: boolean }>
}

export default function CrmContextSection({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [data, setData] = useState<CrmContext | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/crm-context`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, conversationId])

  if (loading || !data || !data.connected) return null

  const c = data.contact
  return (
    <div className="p-5 border-b border-zinc-800">
      <div className="flex items-center justify-between mb-3">
        <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">CRM context</p>
        {data.deepLink && (
          <a
            href={data.deepLink}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
            title="Open in your CRM"
          >
            Open →
          </a>
        )}
      </div>

      {!c ? (
        <p className="text-[11px] text-zinc-500 italic">Couldn&apos;t load contact details.</p>
      ) : (
        <>
          <div className="space-y-1 text-[11px]">
            {c.name && <Row k="Name"   v={c.name} />}
            {c.email && <Row k="Email"  v={c.email} />}
            {c.phone && <Row k="Phone"  v={c.phone} />}
            {c.source && <Row k="Source" v={c.source} />}
          </div>

          {c.tags && c.tags.length > 0 && (
            <div className="mt-3">
              <p className="text-[10px] text-zinc-500 mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1">
                {c.tags.map(t => (
                  <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300">{t}</span>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {data.opportunities.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-zinc-500 mb-1.5">Opportunities ({data.opportunities.length})</p>
          <div className="space-y-1.5">
            {data.opportunities.slice(0, 5).map(o => (
              <div key={o.id} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <p className="text-xs text-white truncate">{o.name}</p>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 mt-0.5">
                  {o.status && <span>{o.status}</span>}
                  {o.monetaryValue != null && <span>· ${o.monetaryValue.toLocaleString()}</span>}
                </div>
              </div>
            ))}
            {data.opportunities.length > 5 && (
              <p className="text-[10px] text-zinc-600 italic">+ {data.opportunities.length - 5} more</p>
            )}
          </div>
        </div>
      )}

      {data.tasks.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-zinc-500 mb-1.5">Open tasks</p>
          <div className="space-y-1">
            {data.tasks.filter(t => !t.completed).slice(0, 5).map(t => (
              <div key={t.id} className="text-[11px] text-zinc-300 truncate">
                <span className="text-zinc-600 mr-1">○</span>{t.title}
                {t.dueDate && <span className="text-[10px] text-zinc-500 ml-1">· {relTime(t.dueDate)}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {data.notes.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] text-zinc-500 mb-1.5">Recent notes</p>
          <div className="space-y-1.5">
            {data.notes.slice(0, 3).map(n => (
              <div key={n.id} className="p-2 rounded-lg bg-zinc-900 border border-zinc-800">
                <p className="text-[11px] text-zinc-300 line-clamp-3">{n.body}</p>
                {n.dateAdded && (
                  <p className="text-[10px] text-zinc-600 mt-1">{relTime(n.dateAdded)}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-zinc-500 shrink-0 w-12">{k}</span>
      <span className="text-zinc-200 truncate">{v}</span>
    </div>
  )
}
