import { NextRequest, NextResponse } from 'next/server'
import { getPortalSession } from '@/lib/portal-auth'
import { db } from '@/lib/db'

type Params = { params: Promise<{ brandId: string; snippetId: string }> }

const MAX_TITLE = 120
const MAX_CONTENT = 4000

async function guard(paramsPromise: Params['params']) {
  const session = await getPortalSession()
  if (!session) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const { brandId, snippetId } = await paramsPromise
  if (!session.brandIds.includes(brandId)) {
    return { error: NextResponse.json({ error: 'Unknown brand' }, { status: 403 }) }
  }
  const snippet = await db.brandSnippet.findFirst({
    where: { id: snippetId, brandId },
    select: { id: true },
  }).catch(() => null)
  if (!snippet) return { error: NextResponse.json({ error: 'Snippet not found' }, { status: 404 }) }
  return { snippetId }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const g = await guard(params)
  if ('error' in g) return g.error

  const body = await req.json().catch(() => ({}))
  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim()) data.title = body.title.trim().slice(0, MAX_TITLE)
  if (typeof body.content === 'string' && body.content.trim()) {
    data.content = body.content.trim().slice(0, MAX_CONTENT)
    data.kind = /^https?:\/\/\S+$/i.test(body.content.trim()) ? 'link' : 'text'
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const snippet = await db.brandSnippet.update({
    where: { id: g.snippetId },
    data,
    select: { id: true, title: true, content: true, kind: true, createdAt: true },
  })
  return NextResponse.json({ snippet })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const g = await guard(params)
  if ('error' in g) return g.error

  // Soft-delete keeps provenance for anything already inserted into replies.
  await db.brandSnippet.update({ where: { id: g.snippetId }, data: { isActive: false } })
  return NextResponse.json({ ok: true })
}
