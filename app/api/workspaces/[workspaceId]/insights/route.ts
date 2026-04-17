import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string }> }

const FALLBACK_PATTERNS = [
  "not sure", "i don't know", "i'm not able to", "let me connect you",
  "checking on that", "i'll have to check", "i cannot", "i'm unsure",
  "would need to", "don't have information", "can't help with",
]

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'should', 'could', 'may', 'might', 'shall', 'can',
  'i', 'you', 'we', 'they', 'he', 'she', 'it', 'my', 'your', 'our',
  'this', 'that', 'these', 'those', 'what', 'how', 'when', 'where',
  'why', 'who', 'whom', 'which', 'to', 'for', 'of', 'with', 'in',
  'on', 'at', 'by', 'from', 'up', 'about', 'as', 'if', 'any', 'all',
  'so', 'not', 'no', 'just', 'also', 'then', 'than', 'there', 'here',
  'me', 'us', 'them', 'him', 'her', 'myself', 'yourself', 'itself',
])

/**
 * GET /api/workspaces/:workspaceId/insights
 *
 * Returns:
 *   - contactHealth: at-risk contacts (ghosting, stalled, etc.)
 *   - knowledgeGaps: frequent fallback themes
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const locations = await db.location.findMany({ where: { workspaceId }, select: { id: true } })
  const locationIds = locations.map(l => l.id)
  if (locationIds.length === 0) {
    return NextResponse.json({ contactHealth: [], knowledgeGaps: [] })
  }

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)

  // ─── Contact Health ─────────────────────────────────────────────────
  const activeStates = await db.conversationStateRecord.findMany({
    where: {
      locationId: { in: locationIds },
      state: 'ACTIVE',
      updatedAt: { gte: since },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { updatedAt: 'desc' },
    take: 200,
  })

  // For each active state, compute risk based on:
  //   - hours since last update
  //   - message count (high = stalled)
  //   - whether a follow-up was cancelled recently
  const now = Date.now()
  const contactHealth = activeStates.map(s => {
    const hoursIdle = (now - new Date(s.updatedAt).getTime()) / 3600000
    let score = 100 // green
    const reasons: string[] = []

    if (hoursIdle > 72) { score -= 40; reasons.push('No response in 3+ days') }
    else if (hoursIdle > 24) { score -= 20; reasons.push('Silent for 24h+') }

    if (s.messageCount >= 15) { score -= 25; reasons.push('Long conversation without resolution') }
    else if (s.messageCount >= 8) { score -= 10; reasons.push('Extended back-and-forth') }

    return {
      contactId: s.contactId,
      conversationId: s.conversationId,
      agent: s.agent,
      messageCount: s.messageCount,
      hoursIdle: Math.round(hoursIdle),
      score: Math.max(0, score),
      risk: score < 50 ? 'high' : score < 80 ? 'medium' : 'low',
      reasons,
      lastActive: s.updatedAt,
    }
  })
  .filter(c => c.score < 90)  // only flag ones that aren't fully healthy
  .sort((a, b) => a.score - b.score)
  .slice(0, 20)

  // ─── Knowledge Gaps ────────────────────────────────────────────────
  const recentLogs = await db.messageLog.findMany({
    where: {
      locationId: { in: locationIds },
      outboundReply: { not: null },
      createdAt: { gte: since },
    },
    include: { agent: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  const fallbacks = recentLogs.filter(log =>
    log.outboundReply && FALLBACK_PATTERNS.some(p => log.outboundReply!.toLowerCase().includes(p))
  )

  // Extract theme keywords from inbound messages
  const themeCount: Record<string, { count: number; examples: string[]; agents: Set<string> }> = {}

  for (const fb of fallbacks) {
    const text = (fb.inboundMessage || '').toLowerCase()
    const words = text
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))

    // Count 2-word phrases (bigrams) for more meaningful themes
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`
      if (!themeCount[bigram]) {
        themeCount[bigram] = { count: 0, examples: [], agents: new Set() }
      }
      themeCount[bigram].count++
      if (themeCount[bigram].examples.length < 3) {
        themeCount[bigram].examples.push(fb.inboundMessage.slice(0, 120))
      }
      if (fb.agent) themeCount[bigram].agents.add(fb.agent.id)
    }
  }

  const knowledgeGaps = Object.entries(themeCount)
    .filter(([, v]) => v.count >= 2) // at least 2 occurrences
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([theme, v]) => ({
      theme,
      count: v.count,
      examples: v.examples,
      agentCount: v.agents.size,
    }))

  return NextResponse.json({
    contactHealth,
    knowledgeGaps,
    stats: {
      totalFallbacks: fallbacks.length,
      totalMessagesAnalyzed: recentLogs.length,
      fallbackRate: recentLogs.length > 0 ? Math.round((fallbacks.length / recentLogs.length) * 100) : 0,
    },
  })
}
