/**
 * Pure helpers for the Text agents list (UI redesign phase 2): listening
 * status, channel → pill mapping, filtering/sorting, KPI aggregates.
 * Extracted from app/dashboard/[workspaceId]/agents/page.tsx so the rules
 * are unit-tested. Tested in agents-list.test.ts.
 */

export type ListeningState = 'live' | 'misconfigured' | 'off'

export interface ListAgent {
  id: string
  name: string
  isActive: boolean
  folderId?: string | null
  agentType?: string
  updatedAt: string
  channelDeployments: { channel: string }[]
  vapiConfig?: { isActive: boolean } | null
  _count: { routingRules: number; conversationStates: number; messageLogs: number }
}

/**
 * Three-state status that mirrors the webhook pre-filter: an active agent
 * only picks up an inbound with ≥1 channel deployment AND ≥1 routing rule.
 */
export function getListeningState(agent: Pick<ListAgent, 'isActive' | 'channelDeployments' | '_count'>): {
  state: ListeningState
  label: string
  reason: string
  fixHref: string | null
} {
  if (!agent.isActive) {
    return { state: 'off', label: 'Off', reason: 'Agent is turned off — flip the toggle to activate.', fixHref: null }
  }
  const hasRules = (agent._count?.routingRules ?? 0) > 0
  const hasChannels = (agent.channelDeployments?.length ?? 0) > 0
  if (!hasRules || !hasChannels) {
    const missing: string[] = []
    if (!hasChannels) missing.push('channel deployment')
    if (!hasRules) missing.push('routing rule')
    return {
      state: 'misconfigured',
      label: 'Not deployed',
      reason: `Active but missing ${missing.join(' + ')} — inbounds will be skipped.`,
      fixHref: 'routing',
    }
  }
  return { state: 'live', label: 'Listening', reason: 'Active and listening on at least one channel.', fixHref: null }
}

export type ChannelPillKind = 'sms' | 'whatsapp' | 'chat' | 'email' | 'voice' | 'facebook' | 'instagram' | 'google'

const CHANNEL_KINDS: Record<string, ChannelPillKind> = {
  SMS: 'sms', WhatsApp: 'whatsapp', Email: 'email', Live_Chat: 'chat', FB: 'facebook', IG: 'instagram', GMB: 'google',
}
export function channelKind(channel: string): ChannelPillKind | null {
  return CHANNEL_KINDS[channel] ?? null
}

/** Channel pills for a row: deployments, plus Voice for voice agents / bolted-on voice. */
export function rowChannels(a: Pick<ListAgent, 'agentType' | 'channelDeployments' | 'vapiConfig'>): ChannelPillKind[] {
  if (a.agentType === 'VOICE') return ['voice']
  const kinds = a.channelDeployments.map(d => channelKind(d.channel)).filter((k): k is ChannelPillKind => !!k)
  const uniq = Array.from(new Set(kinds))
  if (a.vapiConfig?.isActive) uniq.push('voice')
  return uniq
}

export type StatusFilter = 'any' | ListeningState
export type SortKey = 'updated' | 'name' | 'conversations'

export interface ListFilters {
  query: string
  status: StatusFilter
  channel: ChannelPillKind | 'any'
  sort: SortKey
}

export function filterAndSort<T extends ListAgent>(agents: T[], f: ListFilters): T[] {
  const q = f.query.trim().toLowerCase()
  const out = agents.filter(a => {
    if (q && !a.name.toLowerCase().includes(q)) return false
    if (f.status !== 'any' && getListeningState(a).state !== f.status) return false
    if (f.channel !== 'any' && !rowChannels(a).includes(f.channel)) return false
    return true
  })
  const sorted = [...out]
  if (f.sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name))
  else if (f.sort === 'conversations') sorted.sort((a, b) => b._count.conversationStates - a._count.conversationStates)
  else sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  return sorted
}

/** Channels actually in use across the list (drives the channel filter's options). */
export function channelsInUse(agents: ListAgent[]): ChannelPillKind[] {
  return Array.from(new Set(agents.flatMap(rowChannels)))
}

export function agentKpis(agents: ListAgent[]) {
  const states = agents.map(a => getListeningState(a).state)
  return {
    total: agents.length,
    live: states.filter(s => s === 'live').length,
    needAttention: states.filter(s => s === 'misconfigured').length,
    conversations: agents.reduce((n, a) => n + (a._count?.conversationStates ?? 0), 0),
    messages: agents.reduce((n, a) => n + (a._count?.messageLogs ?? 0), 0),
  }
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?'
}

export function timeAgo(dateStr: string, now = Date.now()): string {
  const seconds = Math.floor((now - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
