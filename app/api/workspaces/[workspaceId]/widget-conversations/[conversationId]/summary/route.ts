import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; conversationId: string }> }

const client = new Anthropic()
const MODEL = 'claude-haiku-4-5-20251001'

/**
 * GET /api/workspaces/:ws/widget-conversations/:cid/summary
 *   Returns the cached summary, if any.
 * POST /api/workspaces/:ws/widget-conversations/:cid/summary
 *   Generates (or regenerates) a Haiku summary and caches it on the
 *   WidgetConversation row. Body can include `{ force: true }` to
 *   bypass the cache freshness check.
 *
 * Two-tier read: GET is free, POST burns one Haiku call. The inbox
 * shows the cached one immediately and gives the operator a "refresh"
 * affordance.
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  try {
    const convo = await (db as any).widgetConversation.findFirst({
      where: { id: conversationId, widget: { workspaceId } },
      select: { aiSummary: true, aiSummaryAt: true },
    })
    if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({
      summary: convo.aiSummary ?? null,
      summaryAt: convo.aiSummaryAt?.toISOString() ?? null,
    })
  } catch (err: any) {
    if (err?.code === 'P2022' || /column .* does not exist/i.test(err?.message ?? '')) {
      return NextResponse.json({ summary: null, summaryAt: null, notMigrated: true })
    }
    throw err
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { workspaceId, conversationId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  let body: any = {}
  try { body = await req.json() } catch {}
  const force = body?.force === true

  const convo = await db.widgetConversation.findFirst({
    where: { id: conversationId, widget: { workspaceId } },
    select: { id: true },
  })
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Reuse the cached summary if it's <2 min old, unless forced.
  if (!force) {
    try {
      const existing = await (db as any).widgetConversation.findUnique({
        where: { id: conversationId },
        select: { aiSummary: true, aiSummaryAt: true },
      })
      if (existing?.aiSummary && existing?.aiSummaryAt) {
        const ageMs = Date.now() - new Date(existing.aiSummaryAt).getTime()
        if (ageMs < 2 * 60_000) {
          return NextResponse.json({
            summary: existing.aiSummary,
            summaryAt: existing.aiSummaryAt.toISOString(),
            fromCache: true,
          })
        }
      }
    } catch { /* columns missing — fall through to generate */ }
  }

  const messages = await db.widgetMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: 200,
    select: { role: true, content: true, kind: true, createdAt: true },
  })
  if (messages.length === 0) {
    return NextResponse.json({ summary: null, summaryAt: null, empty: true })
  }

  const transcript = messages
    .filter(m => m.kind === 'text' || !m.kind)
    .map(m => `${m.role === 'agent' ? 'Agent' : m.role === 'visitor' ? 'Visitor' : 'System'}: ${m.content}`)
    .join('\n')
    .slice(0, 12_000)

  let summary = ''
  try {
    const completion = await client.messages.create({
      model: MODEL,
      max_tokens: 220,
      system:
        'Summarise this live-chat transcript for an operator scanning the inbox. ' +
        'Three short bullets max, each <15 words: (1) what the visitor wanted, ' +
        '(2) what was answered or attempted, (3) the current status / open question. ' +
        'Use plain text. No "Bullet:" prefixes. No preamble. If there is nothing yet, ' +
        'output a single line saying so.',
      messages: [{ role: 'user', content: transcript }],
    })
    const block = completion.content.find(b => b.type === 'text') as { type: 'text'; text: string } | undefined
    summary = (block?.text || '').trim()
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Summary generation failed' }, { status: 500 })
  }

  const now = new Date()
  try {
    await (db as any).widgetConversation.update({
      where: { id: conversationId },
      data: { aiSummary: summary, aiSummaryAt: now },
    })
  } catch (err: any) {
    // Persistence is best-effort — if the columns don't exist yet,
    // return the summary anyway so the inbox can show it inline.
    if (err?.code !== 'P2022' && !/column .* does not exist/i.test(err?.message ?? '')) {
      throw err
    }
  }
  return NextResponse.json({ summary, summaryAt: now.toISOString() })
}
