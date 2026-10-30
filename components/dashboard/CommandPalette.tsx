'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import {
  agentItems, contactSearchItem, conversationItems, pageItems, rankItems,
  type PaletteGroup, type PaletteItem,
} from '@/lib/command-palette'
import type { NavGate } from '@/lib/dashboard-nav'

/** Window event the sidebar search box dispatches to open the palette. */
export const OPEN_PALETTE_EVENT = 'xv:open-command-palette'

const GROUP_ORDER: PaletteGroup[] = ['Pages', 'Agents', 'Conversations', 'Contacts']

/**
 * ⌘K / Ctrl+K command palette. Jumps to nav pages and searches agents and
 * conversations from the existing list endpoints (GET /agents, GET /inbox),
 * fetched lazily on first open and cached per workspace. Contact search has
 * no JSON endpoint, so it hands off to the Contacts page's own `?q=` search.
 * Mounted once in the dashboard layout; derives the workspace from the URL.
 */
export default function CommandPalette() {
  const router = useRouter()
  const pathname = usePathname()
  const wsMatch = pathname.match(/^\/dashboard\/([^/]+)/)
  const workspaceId = wsMatch && !['settings', 'new', 'feedback', 'help-admin'].includes(wsMatch[1]) ? wsMatch[1] : null

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [data, setData] = useState<{ ws: string; agents: PaletteItem[]; convs: PaletteItem[]; gates: Partial<Record<NavGate, boolean>> } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const close = useCallback(() => { setOpen(false); setQuery(''); setCursor(0) }, [])

  // Global shortcut + sidebar trigger.
  useEffect(() => {
    if (!workspaceId) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener(OPEN_PALETTE_EVENT, onOpen) }
  }, [workspaceId])

  // Lazy-load searchable data on first open for this workspace.
  useEffect(() => {
    if (!open || !workspaceId || data?.ws === workspaceId) return
    let cancelled = false
    const j = (url: string) => fetch(url).then(r => (r.ok ? r.json() : null)).catch(() => null)
    Promise.all([
      j(`/api/workspaces/${workspaceId}/agents`),
      j(`/api/workspaces/${workspaceId}/inbox`),
      j('/api/workspaces'),
      j(`/api/workspaces/${workspaceId}/settings/ticketing`),
      j(`/api/workspaces/${workspaceId}/domain`),
    ]).then(([agents, inbox, workspaces, ticketing, domain]) => {
      if (cancelled) return
      const ws = workspaces?.workspaces?.find((w: { id: string }) => w.id === workspaceId)
      setData({
        ws: workspaceId,
        agents: agentItems(workspaceId, agents?.agents ?? []),
        convs: conversationItems(workspaceId, inbox?.conversations ?? []),
        gates: {
          'native-crm': Array.isArray(ws?.locations) && ws.locations.some((l: { crmProvider?: string }) => l.crmProvider === 'native'),
          ticketing: !!ticketing?.status?.active,
          whitelabel: !!domain?.canManage,
        },
      })
    })
    return () => { cancelled = true }
  }, [open, workspaceId, data?.ws])

  useEffect(() => { if (open) inputRef.current?.focus() }, [open])

  const results = useMemo(() => {
    if (!workspaceId) return []
    const ready = data?.ws === workspaceId ? data : null
    const pages = rankItems(query, pageItems(workspaceId, ready?.gates ?? {}), query ? 6 : 8)
    const agents = query ? rankItems(query, ready?.agents ?? [], 5) : []
    const convs = query ? rankItems(query, ready?.convs ?? [], 5) : []
    const contact = contactSearchItem(workspaceId, query)
    const all = [...pages, ...agents, ...convs, ...(contact ? [contact] : [])]
    return GROUP_ORDER.flatMap(g => all.filter(i => i.group === g))
  }, [query, data, workspaceId])

  if (!open || !workspaceId) return null

  const go = (item: PaletteItem) => { close(); router.push(item.href) }
  const loading = data?.ws !== workspaceId

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[14vh] bg-stone-900/40" onMouseDown={e => { if (e.target === e.currentTarget) close() }}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-[560px] mx-4 xv-card shadow-2xl overflow-hidden"
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); close() }
          else if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)) }
          else if (e.key === 'Enter' && results[cursor]) { e.preventDefault(); go(results[cursor]) }
        }}
      >
        <div className="flex items-center gap-2 px-4 h-12 border-b border-border-theme">
          <input
            ref={inputRef}
            value={query}
            onChange={e => { setQuery(e.target.value); setCursor(0) }}
            placeholder="Search pages, agents, conversations, contacts…"
            aria-label="Search"
            className="flex-1 bg-transparent outline-none text-[14px] text-text-primary placeholder:text-text-muted"
          />
          <kbd className="rounded bg-surface-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">Esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto py-1.5" role="listbox">
          {results.length === 0 && (
            <p className="px-4 py-6 text-center text-[13px] text-text-tertiary">{loading ? 'Loading…' : 'No matches'}</p>
          )}
          {results.map((item, i) => {
            const showHeader = i === 0 || results[i - 1].group !== item.group
            return (
              <div key={item.id}>
                {showHeader && (
                  <p className="px-4 pt-2 pb-1 text-[10.5px] uppercase tracking-wider font-semibold text-text-muted">{item.group}</p>
                )}
                <button
                  type="button"
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(item)}
                  className={`w-full flex items-center gap-3 px-4 h-9 text-left text-[13px] cursor-pointer ${i === cursor ? 'bg-brand-50 text-brand-700' : 'text-text-primary'}`}
                >
                  <span className="truncate">{item.label}</span>
                  {item.hint && <span className="ml-auto truncate max-w-[45%] text-[11.5px] text-text-tertiary">{item.hint}</span>}
                </button>
              </div>
            )
          })}
          {/* TODO(redesign-followup): contact search is a hand-off to /contacts?q= (native CRM only). A JSON contacts search endpoint would let results show inline. */}
        </div>
      </div>
    </div>
  )
}
