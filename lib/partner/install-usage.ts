/**
 * Usage numbers for a partner (help-center) install — conversations,
 * AI-handled last 7 days, time saved, CSAT. Same definitions as the
 * partner GET route and the portal report email so a customer never
 * sees two different "time saved" figures across surfaces.
 *
 * Shared so the trial-ending cron and any future surface compute the
 * exact same numbers.
 */

import { db } from '@/lib/db'
import { MINUTES_PER_HANDLED } from '@/lib/portal/report-email-render'

export interface InstallUsage {
  conversationCount: number
  aiHandled7d: number
  timeSavedMinutes7d: number
  csatAvg: number | null
  csatCount: number
}

export async function getInstallUsage(widgetId: string | null): Promise<InstallUsage> {
  if (!widgetId) {
    return { conversationCount: 0, aiHandled7d: 0, timeSavedMinutes7d: 0, csatAvg: null, csatCount: 0 }
  }

  const since = new Date(Date.now() - 7 * 86_400_000)
  const [conversationCount, aiHandled7d, csatAgg] = await Promise.all([
    db.widgetConversation.count({ where: { widgetId } }).catch(() => 0),
    db.widgetConversation.count({
      where: {
        widgetId, createdAt: { gte: since },
        assignedUserId: null, messages: { some: { role: 'agent' } },
      },
    }).catch(() => 0),
    db.widgetConversation.aggregate({
      where: { widgetId, csatRating: { not: null } },
      _avg: { csatRating: true }, _count: { csatRating: true },
    }).catch(() => null),
  ])

  return {
    conversationCount,
    aiHandled7d,
    timeSavedMinutes7d: aiHandled7d * MINUTES_PER_HANDLED,
    csatAvg: csatAgg?._avg.csatRating ?? null,
    csatCount: csatAgg?._count.csatRating ?? 0,
  }
}
