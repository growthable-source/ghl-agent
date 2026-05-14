'use client'

/**
 * Persistent, loud, in-app alert when an agent has stopped itself and
 * needs a human. Renders at the top of every workspace dashboard page
 * the moment one or more agents are paused / errored / handed off, so
 * operators don't have to be inside the Inbox to notice.
 *
 * Sources of truth: `/api/workspaces/:ws/needs-attention` (same one the
 * Queue + sidebar badge use). We filter for high-severity items —
 * type='paused' (transfer_to_human, stop condition, manual takeover)
 * and type='error' (agent crashed mid-reply). Medium/low items
 * (fallbacks, stalled) stay quiet in the Queue page — they're noise
 * for an always-on banner.
 *
 * UX rules:
 *   - Banner appears within 12s of pause being recorded
 *   - Plays the notification ping on FIRST appearance per session for
 *     each new item, never on subsequent polls of the same item
 *   - "Take over" deep-links straight into the conversation
 *   - Expand chevron reveals the full list when there's more than one
 *   - Snooze button hides a specific item for 10 min in this tab
 *     (localStorage), so a teammate already handling it can dismiss
 *     without losing the signal forever
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { playNotificationSound } from '@/lib/notification-sound'

type Severity = 'high' | 'medium' | 'low'
type ItemType = 'paused' | 'error' | 'fallback' | 'stalled'

interface AttentionItem {
  type: ItemType
  severity: Severity
  label: string
  reason?: string
  contactId: string
  conversationId?: string | null
  agent: { id: string; name: string } | null
  at: string
  messageCount?: number
  lastMessage?: string
}

const POLL_MS = 12_000
const SNOOZE_MS = 10 * 60 * 1000

// Items that warrant the LOUD banner. Other types stay in the Queue.
const LOUD_TYPES: Set<ItemType> = new Set(['paused', 'error'])

// Cross-route static segments where there's no workspace context.
const NON_WORKSPACE_SEGMENTS = new Set(['undefined', 'new', 'settings', 'feedback'])

export default function HandoffAlertBanner() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string | undefined

  const [items, setItems] = useState<AttentionItem[] | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [snoozed, setSnoozed] = useState<Record<string, number>>({})

  // Track which items we've already pinged about this session so we
  // don't sound the alarm on every 12s poll. Keyed by the same id
  // we use for snooze: agentId + contactId.
  const seenRef = useRef<Set<string>>(new Set())

  // Load existing snoozes on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = localStorage.getItem('handoff-snooze')
      if (!raw) return
      const parsed = JSON.parse(raw) as Record<string, number>
      const now = Date.now()
      // Strip expired snoozes so the map stays small.
      const fresh: Record<string, number> = {}
      for (const [k, until] of Object.entries(parsed)) {
        if (typeof until === 'number' && until > now) fresh[k] = until
      }
      setSnoozed(fresh)
      localStorage.setItem('handoff-snooze', JSON.stringify(fresh))
    } catch { /* localStorage disabled — banner just always shows */ }
  }, [])

  const fetchItems = useCallback(async () => {
    if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/needs-attention`, {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = await res.json()
      const all: AttentionItem[] = Array.isArray(data?.items) ? data.items : []
      const loud = all.filter(i => LOUD_TYPES.has(i.type))
      setItems(loud)

      // Play sound for newly-seen items only. We don't want repeated
      // pings on the same paused conversation every 12s.
      const newOnes = loud.filter(i => !seenRef.current.has(keyFor(i)))
      if (newOnes.length > 0 && seenRef.current.size > 0) {
        // Skip the very first poll — that's the page load showing existing
        // items, not a new pause. Subsequent appearances ping loudly.
        playNotificationSound('inbox')
      }
      for (const i of loud) seenRef.current.add(keyFor(i))
    } catch {
      // Soft fail — the banner is a notifier, not a source of truth.
      // Polling will retry on the next interval.
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return
    fetchItems()
    const id = setInterval(fetchItems, POLL_MS)
    return () => clearInterval(id)
  }, [workspaceId, fetchItems])

  // Refocus → immediate refresh so an operator who alt-tabs back sees
  // truth instantly instead of waiting for the next 12s tick.
  useEffect(() => {
    if (!workspaceId) return
    const onFocus = () => fetchItems()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [workspaceId, fetchItems])

  // Compute visible items first so the document.title effect can use it.
  const visible = (items ?? []).filter(i => {
    const k = keyFor(i)
    const until = snoozed[k] ?? 0
    return until <= Date.now()
  })

  // Flash the browser tab title while there are unresolved alerts.
  // Operators alt-tabbed onto Slack/email still see "(!) Agent needs
  // you" in the tab strip without having to come back to the page.
  // Original title is restored when nothing's pending or on unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return
    const original = document.title
    if (visible.length === 0) return
    const tag = visible.length === 1
      ? '(!) Agent needs you'
      : `(${visible.length}) Agents need you`
    // Strip any prior tag we may have left so we don't stack.
    const base = original.replace(/^\(!\) Agent needs you · |^\(\d+\) Agents need you · /, '')
    document.title = `${tag} · ${base}`
    return () => { document.title = original }
  }, [visible.length])

  if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return null
  if (!items || items.length === 0) return null
  if (visible.length === 0) return null

  const primary = visible[0]
  const extra = visible.length - 1

  function takeOver(item: AttentionItem) {
    if (!workspaceId) return
    if (item.conversationId) {
      router.push(`/dashboard/${workspaceId}/inbox?conversation=${item.conversationId}`)
    } else {
      router.push(`/dashboard/${workspaceId}/contacts/${item.contactId}`)
    }
  }

  function snooze(item: AttentionItem) {
    const k = keyFor(item)
    const until = Date.now() + SNOOZE_MS
    setSnoozed(prev => {
      const next = { ...prev, [k]: until }
      try { localStorage.setItem('handoff-snooze', JSON.stringify(next)) } catch {}
      return next
    })
  }

  return (
    <div
      className="w-full border-b"
      style={{
        background: 'linear-gradient(90deg, rgba(239,68,68,0.16), rgba(220,38,38,0.06))',
        borderColor: 'rgba(239,68,68,0.35)',
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-75" />
          <span className="relative w-2.5 h-2.5 rounded-full bg-red-500" />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-red-200">
            {visible.length === 1
              ? `${primary.agent?.name || 'An agent'} needs you`
              : `${visible.length} agents need you`}
          </p>
          <p className="text-xs text-red-300/80 truncate">
            <span className="font-medium">{labelFor(primary)}</span>
            {primary.reason && <> — {primary.reason}</>}
            <span className="text-red-300/50"> · {timeAgo(primary.at)}</span>
          </p>
        </div>

        <button
          onClick={() => takeOver(primary)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-white transition-colors whitespace-nowrap"
        >
          Take over now
        </button>

        {extra > 0 && (
          <button
            onClick={() => setExpanded(o => !o)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-500/40 text-red-200 hover:bg-red-500/10 transition-colors whitespace-nowrap"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : `+${extra} more`}
          </button>
        )}

        <button
          onClick={() => snooze(primary)}
          className="text-[11px] text-red-300/70 hover:text-red-200 transition-colors whitespace-nowrap"
          title="Hide this alert for 10 minutes on this device"
        >
          Snooze
        </button>
      </div>

      {expanded && extra > 0 && (
        <div className="max-w-6xl mx-auto px-4 pb-3 space-y-1.5">
          {visible.slice(1).map(item => (
            <div
              key={keyFor(item)}
              className="flex items-center gap-3 py-2 px-3 rounded-lg bg-red-950/30 border border-red-500/20"
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-red-200 truncate">
                  {item.agent?.name || 'Agent'} — {labelFor(item)}
                </p>
                {item.reason && (
                  <p className="text-[11px] text-red-300/70 truncate">{item.reason}</p>
                )}
              </div>
              <span className="text-[10px] text-red-300/60 whitespace-nowrap">{timeAgo(item.at)}</span>
              <button
                onClick={() => takeOver(item)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded bg-red-500/90 hover:bg-red-500 text-white whitespace-nowrap"
              >
                Take over
              </button>
              <button
                onClick={() => snooze(item)}
                className="text-[10px] text-red-300/60 hover:text-red-200 transition-colors whitespace-nowrap"
                title="Hide for 10 minutes"
              >
                Snooze
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function keyFor(item: AttentionItem): string {
  return `${item.agent?.id ?? 'na'}|${item.contactId}|${item.type}`
}

function labelFor(item: AttentionItem): string {
  switch (item.type) {
    case 'paused': return 'Agent paused — needs takeover'
    case 'error':  return 'Agent error'
    default:       return item.label
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
