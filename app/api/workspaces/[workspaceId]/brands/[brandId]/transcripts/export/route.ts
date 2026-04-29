import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireWorkspaceAccess } from '@/lib/require-workspace-access'

type Params = { params: Promise<{ workspaceId: string; brandId: string }> }

/**
 * GET — JSON export of every conversation belonging to widgets tagged
 * to this brand. Optional date range:
 *   ?from=2025-01-01&to=2025-04-30
 *   ?status=ended  (or active | handed_off | all — defaults to all)
 *   ?format=json|text  (default json)
 *
 * `format=text` returns a single plain-text concatenation of every
 * conversation's transcript — easy to skim, easy to feed into a CSAT
 * review or QA process.
 *
 * Designed as a single response (no streaming) — capped by the
 * inbound `take` so very large brands don't hit memory limits. We
 * cap at 1,000 conversations per export; chunk via the `from` /
 * `to` filters for bigger archives.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { workspaceId, brandId } = await params
  const access = await requireWorkspaceAccess(workspaceId)
  if (access instanceof NextResponse) return access

  const brand: any = await (db as any).brand.findFirst({
    where: { id: brandId, workspaceId },
  }).catch(() => null)
  if (!brand) return NextResponse.json({ error: 'Brand not found' }, { status: 404 })

  const url = new URL(req.url)
  const fromParam = url.searchParams.get('from')
  const toParam = url.searchParams.get('to')
  const statusParam = url.searchParams.get('status')
  const format = url.searchParams.get('format') === 'text' ? 'text' : 'json'

  const from = fromParam ? new Date(fromParam) : null
  const to = toParam ? new Date(toParam) : null
  if (from && Number.isNaN(from.getTime())) {
    return NextResponse.json({ error: 'Invalid from date' }, { status: 400 })
  }
  if (to && Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: 'Invalid to date' }, { status: 400 })
  }

  const where: any = {
    widget: { workspaceId, brandId },
  }
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = from
    if (to) where.createdAt.lte = to
  }
  if (statusParam && ['active', 'handed_off', 'ended'].includes(statusParam)) {
    where.status = statusParam
  }

  const conversations = await db.widgetConversation.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 1000,
    include: {
      widget: { select: { id: true, name: true } },
      visitor: { select: { id: true, name: true, email: true, phone: true } },
      messages: { orderBy: { createdAt: 'asc' } },
      assignedUser: { select: { id: true, name: true, email: true } } as any,
    } as any,
  })

  const stamp = new Date().toISOString().slice(0, 10)
  const filenameBase = `${brand.slug || brandId}-transcripts-${stamp}`

  if (format === 'text') {
    const text = renderText(brand, conversations as any[])
    return new NextResponse(text, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filenameBase}.txt"`,
      },
    })
  }

  const payload = {
    brand: {
      id: brand.id,
      name: brand.name,
      slug: brand.slug,
      logoUrl: brand.logoUrl,
      primaryColor: brand.primaryColor,
    },
    exportedAt: new Date().toISOString(),
    filters: { from: fromParam, to: toParam, status: statusParam ?? null },
    conversationCount: conversations.length,
    conversations: conversations.map((c: any) => ({
      id: c.id,
      widget: c.widget,
      visitor: c.visitor,
      status: c.status,
      assignedUser: c.assignedUser ?? null,
      assignmentReason: c.assignmentReason ?? null,
      assignedAt: c.assignedAt ? c.assignedAt.toISOString() : null,
      csatRating: c.csatRating ?? null,
      csatComment: c.csatComment ?? null,
      csatSubmittedAt: c.csatSubmittedAt ? c.csatSubmittedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
      lastMessageAt: c.lastMessageAt.toISOString(),
      messages: c.messages.map((m: any) => ({
        role: m.role,
        kind: m.kind,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    })),
  }
  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filenameBase}.json"`,
    },
  })
}

function renderText(brand: any, conversations: any[]): string {
  const lines: string[] = []
  lines.push(`# Transcripts — ${brand.name}`)
  lines.push(`Exported: ${new Date().toISOString()}`)
  lines.push(`Conversations: ${conversations.length}`)
  lines.push('')
  lines.push('═'.repeat(72))
  for (const c of conversations) {
    const visitorLabel = c.visitor?.name || c.visitor?.email || `Visitor ${c.visitor?.id?.slice(-6) ?? ''}`
    lines.push('')
    lines.push(`## ${visitorLabel} · via ${c.widget?.name ?? 'widget'} · ${c.status}`)
    lines.push(`Started: ${c.createdAt.toISOString()}`)
    if (c.assignedUser) lines.push(`Assigned to: ${c.assignedUser.name || c.assignedUser.email}`)
    if (typeof c.csatRating === 'number') {
      lines.push(`CSAT: ${'⭐'.repeat(c.csatRating)} (${c.csatRating}/5)${c.csatComment ? ` — "${c.csatComment}"` : ''}`)
    }
    lines.push('')
    for (const m of c.messages) {
      const who = m.role === 'visitor' ? 'Visitor'
        : m.role === 'agent' ? 'Agent'
        : m.role === 'system' ? 'System'
        : m.role
      const body = m.kind === 'image' ? `[image: ${m.content}]`
        : m.kind === 'file' ? `[file: ${m.content}]`
        : m.content
      lines.push(`${who}: ${body}`)
    }
    lines.push('')
    lines.push('─'.repeat(72))
  }
  return lines.join('\n')
}
