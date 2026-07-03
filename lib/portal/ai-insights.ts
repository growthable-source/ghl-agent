/**
 * Portal AI insights — synthesizes what customers keep asking about into
 * a handful of actionable observations ("your customers asked about
 * upgrades more than anything else this week — consider X").
 *
 * Pattern: compute on demand + cache (the aiSummary precedent, no cron).
 * The Overview page calls getPortalAiInsights(); a fresh cache renders
 * immediately, a stale/missing one triggers a fire-and-forget regenerate
 * that the NEXT page view picks up. All failure paths degrade to null —
 * the panel then shows its "gathering data" state.
 *
 * Raw material: ConversationTopic rows (captured post-reply from the
 *   knowledge retrieval) for theme counts + week-over-week deltas, plus a
 *   few visitor-message snippets per top theme so the model can quote
 *   what people actually say.
 */

import { db } from '@/lib/db'
import { createMessage } from '@/lib/llm'

const WINDOW_DAYS = 7
const FRESH_MS = 24 * 60 * 60 * 1000
const MAX_INSIGHTS = 4

export interface PortalAiInsight {
  headline: string
  detail: string
  suggestedAction: string
}

export interface PortalAiInsightsResult {
  insights: PortalAiInsight[]
  generatedAt: Date
  windowDays: number
  stale: boolean
}

// One in-process guard so a burst of Overview loads doesn't fan out
// duplicate generations (serverless: per-instance, best-effort).
const generating = new Set<string>()

export async function getPortalAiInsights(
  portalId: string,
  widgetIds: string[],
  workspaceId: string | null,
): Promise<PortalAiInsightsResult | null> {
  const cached = await db.portalInsight.findUnique({ where: { portalId } }).catch(() => null)
  const fresh = cached && Date.now() - cached.generatedAt.getTime() < FRESH_MS

  if (!fresh && widgetIds.length > 0 && !generating.has(portalId)) {
    generating.add(portalId)
    // Fire-and-forget: never block the page render on an LLM call.
    void generatePortalInsights(portalId, widgetIds, workspaceId)
      .catch(err => console.warn('[PortalInsights] generation failed:', err?.message))
      .finally(() => generating.delete(portalId))
  }

  if (!cached) return null
  const content = cached.content as unknown
  const insights = Array.isArray(content)
    ? (content as PortalAiInsight[]).filter(
        i => i && typeof i.headline === 'string' && typeof i.detail === 'string',
      ).slice(0, MAX_INSIGHTS)
    : []
  if (insights.length === 0) return null
  return { insights, generatedAt: cached.generatedAt, windowDays: cached.windowDays, stale: !fresh }
}

export async function generatePortalInsights(
  portalId: string,
  widgetIds: string[],
  workspaceId: string | null,
): Promise<void> {
  const now = Date.now()
  const since = new Date(now - WINDOW_DAYS * 86400_000)
  const prevSince = new Date(now - 2 * WINDOW_DAYS * 86400_000)

  // Theme counts, this window vs the one before it.
  const [current, previous] = await Promise.all([
    db.conversationTopic.groupBy({
      by: ['topic'],
      where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { topic: 'desc' } },
      take: 10,
    }).catch(() => []),
    db.conversationTopic.groupBy({
      by: ['topic'],
      where: { widgetId: { in: widgetIds }, createdAt: { gte: prevSince, lt: since } },
      _count: { _all: true },
    }).catch(() => []),
  ])
  if (current.length === 0) return // nothing to say yet

  const prevByTopic = new Map(previous.map(p => [p.topic, p._count._all]))
  const themes = current.map(t => ({
    topic: t.topic,
    count: t._count._all,
    previousWeek: prevByTopic.get(t.topic) ?? 0,
  }))

  // A few verbatim visitor snippets for the top 3 themes.
  const snippets: Record<string, string[]> = {}
  for (const theme of themes.slice(0, 3)) {
    const topicRows = await db.conversationTopic.findMany({
      where: { widgetId: { in: widgetIds }, topic: theme.topic, createdAt: { gte: since } },
      select: { conversationId: true },
      take: 3,
      orderBy: { createdAt: 'desc' },
    }).catch(() => [])
    if (topicRows.length === 0) continue
    const messages = await db.widgetMessage.findMany({
      where: {
        conversationId: { in: topicRows.map(r => r.conversationId) },
        role: 'visitor',
      },
      select: { content: true },
      orderBy: { createdAt: 'asc' },
      take: 6,
    }).catch(() => [])
    snippets[theme.topic] = messages
      .map(m => m.content.slice(0, 240))
      .filter(Boolean)
      .slice(0, 4)
  }

  const totalConversations = await db.widgetConversation.count({
    where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
  }).catch(() => 0)

  const system =
    'You analyze customer-support chat themes for a business owner and write a short, concrete weekly briefing. ' +
    'You are given theme counts (conversations mentioning each theme, this week vs last week) and verbatim customer snippets. ' +
    `Return STRICT JSON only: an array of at most ${MAX_INSIGHTS} objects with keys "headline" (<=90 chars, plain-English observation, lead with the strongest pattern), ` +
    '"detail" (1-2 sentences with the numbers, week-over-week movement when meaningful), and ' +
    '"suggestedAction" (one specific, practical step the business could take). ' +
    'Ground every claim in the data given. No markdown, no preamble, JSON array only.'

  const user = JSON.stringify({
    windowDays: WINDOW_DAYS,
    totalConversations,
    themes,
    customerSnippets: snippets,
  })

  const res = await createMessage(
    null,
    {
      max_tokens: 1200,
      system,
      messages: [{ role: 'user', content: user }],
      temperature: 0.3,
    },
    { surface: 'portal_insights', workspaceId: workspaceId ?? undefined },
  )

  const text = res.content
    .filter((b): b is { type: 'text'; text: string } => (b as any).type === 'text')
    .map(b => b.text)
    .join('')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return
  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return }
  if (!Array.isArray(parsed)) return
  const insights = parsed
    .filter(i => i && typeof i.headline === 'string' && typeof i.detail === 'string' && typeof i.suggestedAction === 'string')
    .slice(0, MAX_INSIGHTS)
  if (insights.length === 0) return

  await db.portalInsight.upsert({
    where: { portalId },
    create: { portalId, content: insights, windowDays: WINDOW_DAYS },
    update: { content: insights, windowDays: WINDOW_DAYS, generatedAt: new Date() },
  }).catch(() => {}) // pre-migration: table may not exist yet
}
