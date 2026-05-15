'use client'

/**
 * Where the visitor is + a numbered path of pages they've been on +
 * any non-page_view activity (identify, custom events) + the visitor's
 * conversation history with this widget.
 *
 * Fed by /api/.../timeline which returns the visitor row plus their
 * full event stream plus every conversation they've had on this
 * widget. Fails quietly to an empty render — the panel is opportunistic
 * context, not load-bearing.
 */

import { useEffect, useState } from 'react'
import { relTime, prettyUrl } from './conversation-helpers'

interface VisitorTimelineData {
  visitor: {
    id: string
    currentUrl?: string | null
    currentTitle?: string | null
    crmContactId?: string | null
  }
  events: Array<{ id: string; kind: string; data: Record<string, unknown>; createdAt: string }>
  conversations: Array<{
    id: string
    status: string
    createdAt: string
    lastMessageAt: string
    messageCount: number
    widget: { id: string; name: string }
  }>
}

export default function VisitorTimelineSection({ workspaceId, conversationId }: { workspaceId: string; conversationId: string }) {
  const [data, setData] = useState<VisitorTimelineData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/workspaces/${workspaceId}/widget-conversations/${conversationId}/timeline`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setData(null) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workspaceId, conversationId])

  if (loading || !data) return null

  const currentUrl = data.visitor.currentUrl
  const currentTitle = data.visitor.currentTitle
  const events = data.events

  // Extract just the page_view events as the visitor's "path through
  // the site." Server sends newest-first; reverse to chronological so
  // the path reads top-down like a breadcrumb. Dedupe consecutive
  // same-URL hits (refreshes don't count as new pages).
  const pagePathChrono: Array<{ id: string; url: string; title: string | null; at: string }> = []
  const pageViewsOldestFirst = [...events.filter(e => e.kind === 'page_view')].reverse()
  for (const e of pageViewsOldestFirst) {
    const url = (e.data?.url as string) || ''
    const title = (e.data?.title as string) || null
    if (!url) continue
    if (pagePathChrono.length > 0 && pagePathChrono[pagePathChrono.length - 1].url === url) continue
    pagePathChrono.push({ id: e.id, url, title, at: e.createdAt })
  }
  const totalPageViews = events.filter(e => e.kind === 'page_view').length
  const otherEvents = events.filter(e => e.kind !== 'page_view')

  if (!currentUrl && pagePathChrono.length === 0 && otherEvents.length === 0 && data.conversations.length <= 1) return null

  return (
    <div className="p-5 border-b border-zinc-800">
      <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-3">Visitor activity</p>

      {/* "Currently on" — most recent page_view URL. THIS is the page
          the visitor is actually viewing, not where the widget is
          embedded (that confusion is what operators kept hitting). */}
      {currentUrl && (
        <div className="mb-4 p-3 rounded-lg bg-zinc-900 border border-orange-500/30">
          <p className="text-[10px] text-orange-400 uppercase tracking-wider font-semibold mb-1">Currently on</p>
          {currentTitle && <p className="text-xs font-medium text-white truncate" title={currentTitle}>{currentTitle}</p>}
          <a
            href={currentUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-orange-300 hover:underline break-all line-clamp-2"
          >
            {prettyUrl(currentUrl)}
          </a>
        </div>
      )}

      {pagePathChrono.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-zinc-500 mb-2 flex items-center gap-2">
            <span className="uppercase tracking-wider font-semibold">Pages visited</span>
            <span className="text-zinc-600 font-normal">
              {pagePathChrono.length} unique
              {totalPageViews > pagePathChrono.length && <> · {totalPageViews} total views</>}
            </span>
          </p>
          <div className="space-y-1.5">
            {pagePathChrono.slice(-12).map((p, i, arr) => {
              const isLast = i === arr.length - 1
              const stepNumber = pagePathChrono.length - arr.length + i + 1
              return (
                <div key={p.id} className="flex items-start gap-2 text-[11px]">
                  <span
                    className={`shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${
                      isLast ? 'bg-orange-500/20 text-orange-300' : 'bg-zinc-800 text-zinc-500'
                    }`}
                  >
                    {stepNumber}
                  </span>
                  <div className="flex-1 min-w-0">
                    {p.title && <p className="text-zinc-200 truncate" title={p.title}>{p.title}</p>}
                    <a
                      href={p.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] text-zinc-500 hover:text-zinc-300 truncate block"
                      title={p.url}
                    >
                      {prettyUrl(p.url)}
                    </a>
                    <p className="text-[10px] text-zinc-600">{relTime(p.at)}</p>
                  </div>
                </div>
              )
            })}
            {pagePathChrono.length > 12 && (
              <p className="text-[10px] text-zinc-600 italic pl-7">+ {pagePathChrono.length - 12} earlier pages</p>
            )}
          </div>
        </div>
      )}

      {(otherEvents.length > 0 || data.conversations.length > 1) && (
        <>
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold mb-2">Other activity</p>
          <div className="space-y-2">
            {otherEvents.slice(0, 10).map(e => (
              <TimelineEvent key={'e_' + e.id} event={e} />
            ))}
            {data.conversations.map(c => (
              <TimelineConversation key={'c_' + c.id} convo={c} active={c.id === conversationId} />
            ))}
          </div>
        </>
      )}

      {pagePathChrono.length === 0 && otherEvents.length === 0 && !currentUrl && (
        <p className="text-[11px] text-zinc-500 italic">
          No page-view events recorded yet. Make sure widget.js is loaded on the page — page-tracking fires automatically.
        </p>
      )}
    </div>
  )
}

function TimelineEvent({ event }: { event: { kind: string; data: Record<string, unknown>; createdAt: string } }) {
  if (event.kind === 'page_view') {
    const url = event.data?.url as string | undefined
    const title = event.data?.title as string | undefined
    return (
      <div className="flex items-start gap-2 text-[11px]">
        <span className="text-zinc-600 mt-0.5">📄</span>
        <div className="flex-1 min-w-0">
          {title && <p className="text-zinc-200 truncate">{title}</p>}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-zinc-500 hover:text-zinc-300 truncate block"
              title={url}
            >
              {prettyUrl(url)}
            </a>
          )}
          <p className="text-[10px] text-zinc-600">{relTime(event.createdAt)}</p>
        </div>
      </div>
    )
  }
  if (event.kind === 'identify') {
    const email = event.data?.email as string | undefined
    const name = event.data?.name as string | undefined
    return (
      <div className="flex items-start gap-2 text-[11px]">
        <span className="text-zinc-600 mt-0.5">👤</span>
        <div className="flex-1 min-w-0">
          <p className="text-zinc-200">Identified {name ? <span className="font-semibold">{name}</span> : null} {email && <span className="font-mono text-[10px] text-zinc-400">{email}</span>}</p>
          <p className="text-[10px] text-zinc-600">{relTime(event.createdAt)}</p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 text-[11px]">
      <span className="text-zinc-600 mt-0.5">·</span>
      <div className="flex-1 min-w-0">
        <p className="text-zinc-300 capitalize">{event.kind.replace(/_/g, ' ')}</p>
        <p className="text-[10px] text-zinc-600">{relTime(event.createdAt)}</p>
      </div>
    </div>
  )
}

function TimelineConversation({ convo, active }: { convo: { id: string; status: string; messageCount: number; createdAt: string; widget: { name: string } }; active: boolean }) {
  return (
    <div className={`flex items-start gap-2 text-[11px] ${active ? 'opacity-100' : 'opacity-80'}`}>
      <span className="text-zinc-600 mt-0.5">💬</span>
      <div className="flex-1 min-w-0">
        <p className={active ? 'text-orange-300' : 'text-zinc-200'}>
          Chat started on {convo.widget.name}
          {active && <span className="ml-1 text-[10px] text-orange-300">(this one)</span>}
        </p>
        <p className="text-[10px] text-zinc-600">
          {convo.messageCount} message{convo.messageCount === 1 ? '' : 's'} · {relTime(convo.createdAt)}
        </p>
      </div>
    </div>
  )
}
