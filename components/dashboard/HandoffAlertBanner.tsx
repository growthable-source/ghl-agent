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
import { useBackgroundPolling } from '@/lib/use-background-polling'

type Severity = 'high' | 'medium' | 'low'
type ItemType = 'paused' | 'error' | 'fallback' | 'stalled'

interface AttentionItem {
  type: ItemType
  severity: Severity
  label: string
  reason?: string
  contactId: string
  conversationId?: string | null
  /**
   * Tells us where this conversation actually lives. Voxility-side inbox
   * exists only for widget conversations (locationId begins with `widget:`).
   * For everything else we look at `crmProvider` to decide whether to
   * deep-link into LeadConnector, HubSpot, or fall back to Voxility's
   * contacts page. Optional for backward-compat with old API responses
   * that didn't ship the fields.
   */
  locationId?: string | null
  crmProvider?: 'ghl' | 'hubspot' | 'native' | 'none' | null
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
  }, [workspaceId, fetchItems])
  // Visibility-aware polling; the existing focus listener below already
  // covers the refresh-on-return case for older browsers.
  useBackgroundPolling(fetchItems, POLL_MS, !!workspaceId && !NON_WORKSPACE_SEGMENTS.has(workspaceId))

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

  /**
   * Widget conversations live in Voxility's own inbox (the only place
   * they exist). Identifiable by the `widget:` prefix on the locationId.
   */
  function isWidgetItem(item: AttentionItem): boolean {
    return !!item.locationId && item.locationId.startsWith('widget:')
  }

  /**
   * Resolve the URL where the operator can actually pick up this
   * conversation. Per-CRM:
   *   - widget       → Voxility inbox
   *   - ghl          → LeadConnector conversations UI
   *   - hubspot      → HubSpot contact record (no conversations UI we own)
   *   - native/none  → Voxility contacts page (the only place native
   *                    conversations are managed)
   *   - unknown      → Voxility contacts fallback
   *
   * The previous version assumed every non-widget item was GHL, which
   * 404'd for native + hubspot installs. Now driven by the explicit
   * crmProvider field shipped on each item.
   */
  function takeOverUrl(item: AttentionItem): { url: string; external: boolean } | null {
    if (!workspaceId) return null

    // Widget conversation → Voxility inbox.
    if (isWidgetItem(item) && item.conversationId) {
      return {
        url: `/dashboard/${workspaceId}/inbox?conversation=${item.conversationId}`,
        external: false,
      }
    }

    // LeadConnector — open the conversation thread directly.
    if (item.crmProvider === 'ghl' && item.locationId && item.conversationId) {
      return {
        url: `https://app.gohighlevel.com/v2/location/${item.locationId}/conversations/conversations/${item.conversationId}`,
        external: true,
      }
    }

    // LeadConnector with no conversationId → contact detail page.
    if (item.crmProvider === 'ghl' && item.locationId && item.contactId) {
      return {
        url: `https://app.gohighlevel.com/v2/location/${item.locationId}/contacts/detail/${item.contactId}`,
        external: true,
      }
    }

    // HubSpot — no conversations URL we can address reliably; deep-link
    // to the contact record. portalId is on the Location row but not in
    // this payload yet; for now we send the operator to the Voxility
    // contact page where they can pick up from the recorded context.
    if (item.crmProvider === 'hubspot' && item.contactId) {
      return {
        url: `/dashboard/${workspaceId}/contacts/${item.contactId}`,
        external: false,
      }
    }

    // Native / none / unknown — Voxility contacts page is the source
    // of truth for these conversations.
    if (item.contactId) {
      return {
        url: `/dashboard/${workspaceId}/contacts/${item.contactId}`,
        external: false,
      }
    }
    return null
  }

  function takeOver(item: AttentionItem) {
    const link = takeOverUrl(item)
    if (!link) return
    if (link.external) {
      window.open(link.url, '_blank', 'noopener')
    } else {
      router.push(link.url)
    }
  }

  function takeOverLabel(item: AttentionItem): string {
    if (isWidgetItem(item)) return 'Take over'
    if (item.crmProvider === 'ghl') return 'Open in CRM'
    // native / hubspot / unknown → operator stays inside Voxility
    return 'Take over'
  }

  function takeOverIsExternal(item: AttentionItem): boolean {
    return item.crmProvider === 'ghl' && !isWidgetItem(item)
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

  // Colour tokens. Previously hardcoded text-red-200 / text-red-300/* —
  // those are Tailwind dark-mode-only values; on light-mode pages with
  // a red-tinted background the text disappeared (Ryan's screenshot of
  // the unreadable banner is the reproducer). Switching to design-token
  // CSS vars makes the banner readable in both themes. Fallbacks are
  // explicit hexes so the banner still works if a host page hasn't
  // loaded the theme tokens.
  const colourText = 'var(--accent-red, #b91c1c)'
  const colourTextSubtle = 'var(--accent-red-subtle, var(--accent-red, #b91c1c))'
  const colourBg = 'var(--accent-red-bg, #fef2f2)'
  const colourBgStrong = 'var(--accent-red, #ef4444)'
  const colourBgStrongHover = 'var(--accent-red-hover, #dc2626)'
  const colourBorder = 'var(--accent-red, #ef4444)'

  return (
    <div
      className="w-full border-b"
      style={{
        background: colourBg,
        borderColor: colourBorder,
        color: colourText,
      }}
      role="alert"
      aria-live="polite"
    >
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-3">
        <span className="relative inline-flex w-2.5 h-2.5 shrink-0">
          <span className="absolute inset-0 rounded-full animate-ping opacity-75" style={{ background: colourBgStrong }} />
          <span className="relative w-2.5 h-2.5 rounded-full" style={{ background: colourBgStrong }} />
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: colourText }}>
            {visible.length === 1
              ? `${primary.agent?.name || 'An agent'} needs you`
              : `${visible.length} agents need you`}
          </p>
          <p className="text-xs truncate" style={{ color: colourTextSubtle, opacity: 0.85 }}>
            <span className="font-medium">{labelFor(primary)}</span>
            {primary.reason && <> — {primary.reason}</>}
            <span style={{ opacity: 0.65 }}> · {timeAgo(primary.at)}</span>
          </p>
        </div>

        <button
          onClick={() => takeOver(primary)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
          style={{ background: colourBgStrong, color: '#fff' }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = colourBgStrongHover }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = colourBgStrong }}
          title={
            takeOverIsExternal(primary)
              ? 'Open the conversation in LeadConnector (new tab)'
              : 'Open the conversation in Voxility'
          }
        >
          {takeOverLabel(primary) === 'Open in CRM' ? 'Open in CRM' : 'Take over now'}
          {takeOverIsExternal(primary) && <span aria-hidden> ↗</span>}
        </button>

        {extra > 0 && (
          <button
            onClick={() => setExpanded(o => !o)}
            className="text-xs font-medium px-2.5 py-1.5 rounded-lg transition-colors whitespace-nowrap"
            style={{ border: `1px solid ${colourBorder}`, color: colourText, background: 'transparent' }}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide' : `+${extra} more`}
          </button>
        )}

        <button
          onClick={() => snooze(primary)}
          className="text-[11px] transition-colors whitespace-nowrap"
          style={{ color: colourTextSubtle, opacity: 0.85 }}
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
              className="flex items-center gap-3 py-2 px-3 rounded-lg"
              style={{
                background: 'rgba(255,255,255,0.5)',
                border: `1px solid ${colourBorder}`,
              }}
            >
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: colourText }}>
                  {item.agent?.name || 'Agent'} — {labelFor(item)}
                </p>
                {item.reason && (
                  <p className="text-[11px] truncate" style={{ color: colourTextSubtle, opacity: 0.85 }}>{item.reason}</p>
                )}
              </div>
              <span className="text-[10px] whitespace-nowrap" style={{ color: colourTextSubtle, opacity: 0.7 }}>{timeAgo(item.at)}</span>
              <button
                onClick={() => takeOver(item)}
                className="text-[11px] font-semibold px-2.5 py-1 rounded whitespace-nowrap"
                style={{ background: colourBgStrong, color: '#fff' }}
                title={
                  takeOverIsExternal(item)
                    ? 'Open the conversation in LeadConnector (new tab)'
                    : 'Open the conversation in Voxility'
                }
              >
                {takeOverLabel(item)}{takeOverIsExternal(item) && <span aria-hidden> ↗</span>}
              </button>
              <button
                onClick={() => snooze(item)}
                className="text-[10px] transition-colors whitespace-nowrap"
                style={{ color: colourTextSubtle, opacity: 0.7 }}
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
