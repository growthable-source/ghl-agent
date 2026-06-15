/**
 * Data for the portal Overview's insight panels — the word cloud
 * ("What People Ask About") and Top Topics ("knowledge the AI used").
 * Extracted from app/portal/page.tsx so the page stays focused on layout.
 *
 * Both loads are best-effort: any failure (or the ConversationTopic table
 * missing pre-migration) yields an empty result rather than throwing, so a
 * telemetry gap never takes down the Overview.
 */

import { db } from '@/lib/db'
import { topTerms, type Term } from '@/lib/word-cloud'

export interface OverviewInsights {
  /** Top words/phrases from visitor questions, sized by frequency. */
  cloudTerms: Term[]
  /** Knowledge collections the AI matched, by distinct conversations. */
  topTopics: { topic: string; count: number }[]
}

export async function getOverviewInsights(params: {
  widgetIds: string[]
  since: Date
}): Promise<OverviewInsights> {
  const { widgetIds, since } = params
  if (widgetIds.length === 0) return { cloudTerms: [], topTopics: [] }

  const [cloudTerms, topTopics] = await Promise.all([
    loadCloudTerms(widgetIds, since),
    loadTopTopics(widgetIds, since),
  ])
  return { cloudTerms, topTopics }
}

// Top words/phrases visitors are asking for help with, straight from their
// own messages (capped). Retroactive — works on existing history.
async function loadCloudTerms(widgetIds: string[], since: Date): Promise<Term[]> {
  try {
    const visitorMsgs = await db.widgetMessage.findMany({
      where: { role: 'visitor', createdAt: { gte: since }, conversation: { is: { widgetId: { in: widgetIds } } } },
      select: { content: true },
      orderBy: { createdAt: 'desc' },
      take: 4000,
    })
    return topTerms(visitorMsgs.map(m => m.content), { limit: 36, minCount: 2 })
  } catch {
    return []
  }
}

// The knowledge collections the AI matched to answer visitor questions
// (ConversationTopic telemetry). Count = distinct conversations per topic.
// Forward-looking: only conversations after the feature shipped carry rows.
async function loadTopTopics(widgetIds: string[], since: Date): Promise<{ topic: string; count: number }[]> {
  try {
    const groups = await db.conversationTopic.groupBy({
      by: ['topic'],
      where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { topic: 'desc' } },
      take: 8,
    })
    return groups.map(g => ({ topic: g.topic, count: g._count._all }))
  } catch {
    return []
  }
}
