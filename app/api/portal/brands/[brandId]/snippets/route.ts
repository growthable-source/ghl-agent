import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

type Params = { params: Promise<{ brandId: string }> }

const MAX_TITLE = 120
const MAX_CONTENT = 4000

/**
 * Brand snippet library — pre-approved links and blurbs (calendar link,
 * contact details, policy one-liners) that ticketing agents can insert
 * into replies and the AI can weave into suggested drafts.
 *
 *   GET  — active snippets for the brand
 *   POST { title, content, kind? } — add one
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { brandId } = await params
  if (!session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Unknown brand' }, { status: 403 })
  }

  const snippets = await db.brandSnippet.findMany({
    where: { brandId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, title: true, content: true, kind: true, createdAt: true },
  }).catch(() => []) // pre-migration: table missing

  return NextResponse.json({ snippets })
}

export async function POST(req: NextRequest, { params }: Params) {
  const session = await getPortalSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { brandId } = await params
  if (!session.brandIds.includes(brandId)) {
    return NextResponse.json({ error: 'Unknown brand' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, MAX_TITLE) : ''
  const content = typeof body.content === 'string' ? body.content.trim().slice(0, MAX_CONTENT) : ''
  if (!title || !content) {
    return NextResponse.json({ error: 'Both a title and content are required.' }, { status: 400 })
  }
  const kind = body.kind === 'link' || looksLikeUrl(content) ? 'link' : 'text'

  try {
    const snippet = await db.brandSnippet.create({
      data: {
        brandId,
        title,
        content,
        kind,
        // Admin-preview sessions have no PortalUser row — leave provenance null.
        createdByPortalUserId: session.userId === 'admin-preview' ? null : session.userId,
      },
      select: { id: true, title: true, content: true, kind: true, createdAt: true },
    })
    return NextResponse.json({ snippet })
  } catch {
    return NextResponse.json(
      { error: 'Snippets aren’t initialised on this database yet. Please try again later.' },
      { status: 503 },
    )
  }
}

function looksLikeUrl(content: string): boolean {
  return /^https?:\/\/\S+$/i.test(content.trim())
}
