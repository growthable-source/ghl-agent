/**
 * Support leaderboard — who leans on support the most, across chats AND
 * tickets, with week-over-week rank movement. Identity key is the
 * lowercased email (visitors without one can't be tracked across weeks,
 * so they're excluded rather than shown as a meaningless "Anonymous"
 * pile).
 *
 * Tone note (deliberate product choice): this is presented playfully —
 * "most engaged", medals, movement arrows — because heavy support use
 * is a signal of engagement and of documentation gaps, not misbehavior.
 * Copy in the surfaces that render this should celebrate, not shame.
 *
 * Used by the portal Overview panel and the scheduled email report.
 */

import { db } from '@/lib/db'

export interface LeaderboardEntry {
  email: string
  name: string | null
  chats: number
  tickets: number
  score: number
  rank: number
  /** Rank last window; null = wasn't on the board (new entry). */
  prevRank: number | null
  /** positive = climbed, negative = dropped, 0 = held, null = new. */
  movement: number | null
}

async function usageByEmail(
  widgetIds: string[],
  brandIds: string[],
  from: Date,
  to: Date | null,
): Promise<Map<string, { name: string | null; chats: number; tickets: number }>> {
  const createdAt = to ? { gte: from, lt: to } : { gte: from }
  const [convs, tickets] = await Promise.all([
    db.widgetConversation.findMany({
      where: {
        widgetId: { in: widgetIds },
        createdAt,
        visitor: { is: { email: { not: null } } },
      },
      select: { visitor: { select: { email: true, name: true } } },
    }).catch(() => []),
    db.ticket.findMany({
      where: { brandId: { in: brandIds }, createdAt },
      select: { contactEmail: true, contactName: true },
    }).catch(() => []),
  ])

  const map = new Map<string, { name: string | null; chats: number; tickets: number }>()
  const bump = (emailRaw: string | null, name: string | null, kind: 'chats' | 'tickets') => {
    const email = emailRaw?.trim().toLowerCase()
    if (!email) return
    const entry = map.get(email) ?? { name: null, chats: 0, tickets: 0 }
    entry[kind]++
    if (!entry.name && name) entry.name = name
    map.set(email, entry)
  }
  for (const c of convs) bump(c.visitor.email, c.visitor.name, 'chats')
  for (const t of tickets) bump(t.contactEmail, t.contactName, 'tickets')
  return map
}

function rank(map: Map<string, { name: string | null; chats: number; tickets: number }>) {
  return [...map.entries()]
    .map(([email, v]) => ({ email, ...v, score: v.chats + v.tickets }))
    .sort((a, b) => b.score - a.score || a.email.localeCompare(b.email))
}

export async function getSupportLeaderboard(
  widgetIds: string[],
  brandIds: string[],
  windowDays: number,
  top = 10,
): Promise<LeaderboardEntry[]> {
  if (widgetIds.length === 0 && brandIds.length === 0) return []
  const now = Date.now()
  const since = new Date(now - windowDays * 86_400_000)
  const prevSince = new Date(now - 2 * windowDays * 86_400_000)

  const [currentMap, prevMap] = await Promise.all([
    usageByEmail(widgetIds, brandIds, since, null),
    usageByEmail(widgetIds, brandIds, prevSince, since),
  ])

  const prevRanks = new Map(rank(prevMap).map((e, i) => [e.email, i + 1]))
  return rank(currentMap).slice(0, top).map((e, i) => {
    const prevRank = prevRanks.get(e.email) ?? null
    return {
      email: e.email,
      name: e.name,
      chats: e.chats,
      tickets: e.tickets,
      score: e.score,
      rank: i + 1,
      prevRank,
      movement: prevRank == null ? null : prevRank - (i + 1),
    }
  })
}
