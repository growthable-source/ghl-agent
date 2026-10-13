/**
 * Pure logic for the ⌘K command palette and the top-bar widgets (no React,
 * no fetching — unit-tested in command-palette.test.ts).
 *
 * The palette reuses data the dashboard already loads: nav pages from
 * lib/dashboard-nav, agents from GET /agents, conversations from GET /inbox.
 * There is no JSON contact-search endpoint (the Contacts page is a server
 * component driven by `?q=`), so contacts are searched by jumping to that
 * existing query rather than by adding an endpoint.
 */

import { NAV_ITEMS, SETTINGS_NAV, type NavGate } from './dashboard-nav'

export type PaletteGroup = 'Pages' | 'Agents' | 'Conversations' | 'Contacts'

export interface PaletteItem {
  id: string
  group: PaletteGroup
  label: string
  hint?: string
  href: string
}

/** Lower is better; -1 = no match. Prefix beats word-start beats substring. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const t = text.toLowerCase()
  if (t.startsWith(q)) return 0
  if (t.split(/[\s·\-_/]+/).some(w => w.startsWith(q))) return 1
  return t.includes(q) ? 2 : -1
}

/** Filter + rank by label (then hint, as a weaker signal). Empty query keeps input order. */
export function rankItems<T extends { label: string; hint?: string }>(query: string, items: T[], limit = 8): T[] {
  if (!query.trim()) return items.slice(0, limit)
  const scored: Array<{ item: T; s: number; i: number }> = []
  items.forEach((item, i) => {
    const a = matchScore(query, item.label)
    const b = item.hint ? matchScore(query, item.hint) : -1
    const s = a >= 0 ? a : b >= 0 ? b + 3 : -1
    if (s >= 0) scored.push({ item, s, i })
  })
  scored.sort((x, y) => x.s - y.s || x.i - y.i)
  return scored.slice(0, limit).map(x => x.item)
}

export function pageItems(workspaceId: string, gates: Partial<Record<NavGate, boolean>> = {}): PaletteItem[] {
  const base = `/dashboard/${workspaceId}`
  const out: PaletteItem[] = []
  for (const item of NAV_ITEMS) {
    if (item.gate && !gates[item.gate]) continue
    for (const p of item.pages) {
      out.push({
        id: `page:${item.key}:${p.path}`,
        group: 'Pages',
        label: p.label,
        hint: p.label === item.label ? undefined : item.label,
        href: `${base}${p.path}`,
      })
    }
  }
  for (const g of SETTINGS_NAV) {
    for (const s of g.items) {
      out.push({ id: `settings:${s.path}`, group: 'Pages', label: s.label, hint: `Settings · ${g.group}`, href: `${base}${s.path}${s.tab ? `?tab=${s.tab}` : ''}` })
    }
  }
  // De-dupe by href (Integrations appears in nav and settings).
  const seen = new Set<string>()
  return out.filter(i => (seen.has(i.href) ? false : (seen.add(i.href), true)))
}

interface AgentLike { id: string; name?: string | null; vapiConfig?: unknown }
export function agentItems(workspaceId: string, agents: AgentLike[]): PaletteItem[] {
  return agents.map(a => {
    const voice = !!a.vapiConfig
    return {
      id: `agent:${a.id}`,
      group: 'Agents' as const,
      label: a.name || 'Untitled agent',
      hint: voice ? 'Voice agent' : 'Text agent',
      href: `/dashboard/${workspaceId}/${voice ? 'voice' : 'agents'}/${a.id}`,
    }
  })
}

interface ConversationLike {
  id: string
  visitor?: { name?: string | null; email?: string | null } | null
  lastMessage?: { content?: string | null } | null
}
export function conversationItems(workspaceId: string, rows: ConversationLike[]): PaletteItem[] {
  return rows.map(c => ({
    id: `conv:${c.id}`,
    group: 'Conversations' as const,
    label: c.visitor?.name || c.visitor?.email || 'Anonymous visitor',
    hint: c.lastMessage?.content?.trim() || c.visitor?.email || undefined,
    href: `/dashboard/${workspaceId}/inbox/${encodeURIComponent(c.id)}`,
  }))
}

/** "Search contacts for …" — jumps to the Contacts page's existing ?q= search. */
export function contactSearchItem(workspaceId: string, query: string): PaletteItem | null {
  const q = query.trim()
  if (q.length < 2) return null
  return {
    id: 'contacts:search',
    group: 'Contacts',
    label: `Search contacts for “${q}”`,
    href: `/dashboard/${workspaceId}/contacts?q=${encodeURIComponent(q)}`,
  }
}

// ─── Date range (top bar) ───────────────────────────────────────────────

export const RANGE_OPTIONS = ['7d', '30d', '90d'] as const
export type RangeOption = (typeof RANGE_OPTIONS)[number]
export const RANGE_LABELS: Record<RangeOption, string> = { '7d': '7 days', '30d': '30 days', '90d': '90 days' }

export function parseRange(v: string | null | undefined): RangeOption {
  return (RANGE_OPTIONS as readonly string[]).includes(v ?? '') ? (v as RangeOption) : '7d'
}

/**
 * Which page the top-bar range control applies to. Only the Dashboard has a
 * range-aware data source today (GET /analytics?range=); Insights and
 * Activity pages exist but their APIs take no range, so the control is shown
 * disabled there (TODO(redesign-followup)).
 */
export function rangeSupport(rest: string | null): 'enabled' | 'disabled' | 'hidden' {
  if (rest === '') return 'enabled'
  if (rest && (rest === '/insights' || rest.startsWith('/insights/') || rest === '/activity' || rest.startsWith('/activity/'))) return 'disabled'
  return 'hidden'
}

// ─── Bell ───────────────────────────────────────────────────────────────

export interface BellItem { key: string; title: string; detail?: string; href: string }

interface HeartbeatLike {
  attention?: { items?: Array<{ type?: string; label?: string; reason?: string; agent?: { name?: string } | null; conversationId?: string | null }> } | null
  approvals?: { count?: number; items?: unknown[] } | null
  recent?: { chats?: unknown[] } | null
}

export function bellSummary(hb: HeartbeatLike | null, workspaceId: string) {
  const base = `/dashboard/${workspaceId}`
  const items: BellItem[] = (hb?.attention?.items ?? []).slice(0, 8).map((it, i) => ({
    key: `att:${i}`,
    title: it.label || 'Needs attention',
    detail: [it.agent?.name, it.reason].filter(Boolean).join(' · ') || undefined,
    href: `${base}/queue`,
  }))
  const attentionTotal = hb?.attention?.items?.length ?? 0
  const approvals = typeof hb?.approvals?.count === 'number' ? hb.approvals.count : (hb?.approvals?.items?.length ?? 0)
  if (approvals > 0) {
    items.unshift({
      key: 'approvals',
      title: `${approvals} approval${approvals === 1 ? '' : 's'} waiting`,
      detail: 'An agent is waiting on a human decision',
      href: `${base}/approvals`,
    })
  }
  return { items, count: attentionTotal + approvals }
}

/** Live pill: chats opened in the last ~10 min on live-chat widgets (heartbeat `recent`). */
export function liveChatCount(hb: HeartbeatLike | null): number {
  return hb?.recent?.chats?.length ?? 0
}
