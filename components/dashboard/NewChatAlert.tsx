'use client'

/**
 * On-screen popup when a NEW live chat comes in — in addition to the
 * notification ping. Sherry's ask: the alarm sound alone is easy to miss
 * when you're heads-down in another tab/page, so surface a visible card
 * too. Renders bottom-right toasts that stack, auto-dismiss, and deep-link
 * straight into the conversation.
 *
 * Distinct from HandoffAlertBanner (which is the LOUD red banner for
 * agents that paused/errored). This one is the friendly "someone wants to
 * chat" nudge. Both can be on screen at once without conflict.
 *
 * Detection: polls /widget-conversations/recent. The first poll seeds the
 * "already seen" set silently (so opening the dashboard doesn't fire a
 * popup for every chat from the last 10 minutes); subsequent polls pop +
 * ping only for conversations we haven't seen before.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { playNotificationSound } from '@/lib/notification-sound'
import { useBackgroundPolling } from '@/lib/use-background-polling'

interface RecentChat {
  id: string
  createdAt: string
  assigned: boolean
  widgetName: string
  visitorLabel: string
  preview: string
}

const POLL_MS = 10_000
const AUTO_DISMISS_MS = 18_000
const MAX_VISIBLE = 3

const NON_WORKSPACE_SEGMENTS = new Set(['undefined', 'new', 'settings', 'feedback'])

export default function NewChatAlert() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string | undefined

  // Conversations we've already alerted on (or seeded on first poll).
  const seenRef = useRef<Set<string>>(new Set())
  const seededRef = useRef(false)
  const [popups, setPopups] = useState<RecentChat[]>([])
  const dismissTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  const dismiss = useCallback((id: string) => {
    setPopups(prev => prev.filter(p => p.id !== id))
    const t = dismissTimers.current[id]
    if (t) { clearTimeout(t); delete dismissTimers.current[id] }
  }, [])

  const enqueue = useCallback((chat: RecentChat) => {
    setPopups(prev => {
      if (prev.some(p => p.id === chat.id)) return prev
      // Keep the newest MAX_VISIBLE; drop the oldest if over.
      const next = [chat, ...prev].slice(0, MAX_VISIBLE)
      return next
    })
    dismissTimers.current[chat.id] = setTimeout(() => dismiss(chat.id), AUTO_DISMISS_MS)
  }, [dismiss])

  const fetchRecent = useCallback(async () => {
    if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/widget-conversations/recent`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      const chats: RecentChat[] = Array.isArray(data?.chats) ? data.chats : []

      if (!seededRef.current) {
        // First poll after mount / workspace switch — remember what's
        // already there without popping, so we only alert on genuinely
        // new chats from here on.
        for (const c of chats) seenRef.current.add(c.id)
        seededRef.current = true
        return
      }

      const fresh = chats.filter(c => !seenRef.current.has(c.id))
      if (fresh.length > 0) {
        playNotificationSound('inbox')
        // Show newest first; cap how many cards we stack at once.
        for (const c of fresh.slice(0, MAX_VISIBLE)) enqueue(c)
        for (const c of fresh) seenRef.current.add(c.id)
      }
    } catch {
      // Polled notifier — soft-fail and retry next tick.
    }
  }, [workspaceId, enqueue])

  // Reset seeding when the workspace changes so we don't carry one
  // workspace's seen-set into another.
  useEffect(() => {
    seededRef.current = false
    seenRef.current = new Set()
    setPopups([])
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return
    fetchRecent()
  }, [workspaceId, fetchRecent])

  useBackgroundPolling(fetchRecent, POLL_MS, !!workspaceId && !NON_WORKSPACE_SEGMENTS.has(workspaceId))

  // Clear timers on unmount.
  useEffect(() => () => {
    for (const t of Object.values(dismissTimers.current)) clearTimeout(t)
    dismissTimers.current = {}
  }, [])

  if (!workspaceId || NON_WORKSPACE_SEGMENTS.has(workspaceId)) return null
  if (popups.length === 0) return null

  function open(chat: RecentChat) {
    dismiss(chat.id)
    router.push(`/dashboard/${workspaceId}/inbox?conversation=${chat.id}`)
  }

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]">
      {popups.map(chat => (
        <div
          key={chat.id}
          className="rounded-xl border shadow-2xl overflow-hidden animate-[fadeIn_0.2s_ease]"
          style={{ background: 'var(--surface)', borderColor: 'var(--border-secondary, var(--border))' }}
          role="alert"
        >
          <div className="p-3">
            <div className="flex items-start gap-2.5">
              <span className="relative inline-flex mt-0.5">
                <span className="absolute inline-flex h-2.5 w-2.5 rounded-full opacity-75 animate-ping" style={{ background: 'var(--accent-emerald, #34d399)' }} />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: 'var(--accent-emerald, #34d399)' }} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                  💬 New chat — {chat.visitorLabel}
                </p>
                <p className="text-[11px] truncate" style={{ color: 'var(--text-tertiary)' }}>
                  on {chat.widgetName}{chat.assigned ? ' · already assigned' : ''}
                </p>
                {chat.preview && (
                  <p className="text-[11px] mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                    “{chat.preview}”
                  </p>
                )}
              </div>
              <button
                onClick={() => dismiss(chat.id)}
                className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label="Dismiss"
                title="Dismiss"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="mt-2.5 flex justify-end">
              <button
                onClick={() => open(chat)}
                className="text-[11px] font-semibold px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-90"
                style={{ background: 'var(--accent-primary, #fa4d2e)' }}
              >
                Open chat →
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
