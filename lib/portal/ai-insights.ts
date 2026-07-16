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
 * Raw material: the transcripts themselves — a bounded sample of verbatim
 *   visitor messages from the window (up to 2 per conversation, newest
 *   conversations first). That's the primary source ON PURPOSE: it exists
 *   from day one for every portal. ConversationTopic rows (captured
 *   post-reply from knowledge retrieval) are supplementary when present —
 *   they add clean week-over-week theme deltas, but they're forward-only
 *   telemetry that starts empty, and an insights panel that waits on them
 *   shows nothing for weeks (the original design's mistake).
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
): Promise<PortalAiInsight[] | null> {
  const now = Date.now()
  const since = new Date(now - WINDOW_DAYS * 86400_000)
  const prevSince = new Date(now - 2 * WINDOW_DAYS * 86400_000)

  // PRIMARY source: verbatim visitor messages from the window. Newest
  // conversations first, at most 2 messages per conversation (the opener
  // carries the intent), each truncated — bounds the prompt to roughly
  // 10-15k tokens at the caps below regardless of chat volume.
  const recentConvos = await db.widgetConversation.findMany({
    where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
    select: { id: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }).catch(() => [] as { id: string }[])

  const visitorQuestions: string[] = []
  let sampledConversations = 0
  if (recentConvos.length > 0) {
    const msgs = await db.widgetMessage.findMany({
      where: { conversationId: { in: recentConvos.map(c => c.id) }, role: 'visitor' },
      select: { conversationId: true, content: true },
      orderBy: { createdAt: 'asc' },
      take: 1500,
    }).catch(() => [] as { conversationId: string; content: string }[])
    const perConvo = new Map<string, number>()
    for (const m of msgs) {
      if (visitorQuestions.length >= 300) break
      const seen = perConvo.get(m.conversationId) ?? 0
      if (seen >= 2) continue
      const text = m.content.trim()
      if (!text) continue
      perConvo.set(m.conversationId, seen + 1)
      visitorQuestions.push(text.slice(0, 180))
    }
    sampledConversations = perConvo.size
  }

  // SUPPLEMENTARY: theme counts from knowledge-retrieval telemetry, this
  // window vs the one before. Forward-only and often empty — used for
  // week-over-week movement when present, never required.
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
  const prevByTopic = new Map(previous.map(p => [p.topic, p._count._all]))
  const themes = current.map(t => ({
    topic: t.topic,
    count: t._count._all,
    previousWeek: prevByTopic.get(t.topic) ?? 0,
  }))

  if (visitorQuestions.length === 0 && themes.length === 0) return null // nothing to say yet

  const [totalConversations, previousWindowConversations] = await Promise.all([
    db.widgetConversation.count({
      where: { widgetId: { in: widgetIds }, createdAt: { gte: since } },
    }).catch(() => 0),
    db.widgetConversation.count({
      where: { widgetId: { in: widgetIds }, createdAt: { gte: prevSince, lt: since } },
    }).catch(() => 0),
  ])

  const system =
    'You analyze raw customer-support chat transcripts for a business owner and write a short, concrete weekly briefing. ' +
    'You are given a sample of verbatim visitor messages from the window (up to 2 per conversation), conversation totals for this window and the previous one, ' +
    'and optionally theme counts from knowledge-retrieval telemetry (this window vs the previous). ' +
    'Find the handful of SPECIFIC things customers keep asking for. Name the exact feature or task — ' +
    '"how to install the Meta/Facebook pixel on landing pages", not "integrations"; "connecting a custom domain", not "setup questions". ' +
    `Return STRICT JSON only: an array of at most ${MAX_INSIGHTS} objects with keys ` +
    '"headline" (<=90 chars, a plain-English finding a busy owner absorbs at a glance, e.g. "Most asked this week: installing the Meta pixel on landing pages"), ' +
    '"detail" (1-2 sentences quantifying it honestly from the sample — "came up in roughly a quarter of sampled chats"; give week-over-week movement ONLY when the theme data supports it; never invent precise counts), and ' +
    '"suggestedAction" (one specific, practical step — a help article to write, knowledge to add to the assistant, a UI shortcut to build). ' +
    'Order insights by how often the pattern appears. Ground every claim in the data given. No markdown, no preamble, JSON array only.'

  const user = JSON.stringify({
    windowDays: WINDOW_DAYS,
    totalConversations,
    previousWindowConversations,
    sampledConversations,
    visitorQuestions,
    themes,
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
  if (start === -1 || end === -1 || end <= start) return null
  let parsed: unknown
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  if (!Array.isArray(parsed)) return null
  const insights = parsed
    .filter(i => i && typeof i.headline === 'string' && typeof i.detail === 'string' && typeof i.suggestedAction === 'string')
    .slice(0, MAX_INSIGHTS) as PortalAiInsight[]
  if (insights.length === 0) return null

  await db.portalInsight.upsert({
    where: { portalId },
    create: { portalId, content: insights as unknown as object, windowDays: WINDOW_DAYS },
    update: { content: insights as unknown as object, windowDays: WINDOW_DAYS, generatedAt: new Date() },
  }).catch(() => {}) // pre-migration: table may not exist yet
  return insights
}
