import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'

/**
 * Help articles CRUD.
 *
 *   GET  /api/help/articles            — public, lists published articles
 *   GET  /api/help/articles?all=1      — admin only, includes drafts
 *   POST /api/help/articles            — admin only, creates an article
 */

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const wantAll = searchParams.get('all') === '1'

  if (wantAll) {
    const { ok } = await isSuperAdmin()
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const articles = await db.helpArticle.findMany({
    where: wantAll ? {} : { status: 'published' },
    orderBy: [{ order: 'asc' }, { createdAt: 'desc' }],
    include: { category: true },
  })
  return NextResponse.json({ articles })
}

export async function POST(req: NextRequest) {
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden — super-admin only' }, { status: 403 })

  const body = await req.json()
  if (!body.title?.trim()) return NextResponse.json({ error: 'title required' }, { status: 400 })
  if (!body.body?.trim()) return NextResponse.json({ error: 'body required' }, { status: 400 })

  // Slug: either user-provided or derived from title. Ensure uniqueness by
  // appending -2, -3, ... on collision rather than failing the request.
  let slug = (body.slug && slugify(body.slug)) || slugify(body.title)
  let suffix = 1
  // eslint-disable-next-line no-await-in-loop
  while (await db.helpArticle.findUnique({ where: { slug } })) {
    suffix++
    slug = `${slugify(body.slug || body.title)}-${suffix}`
  }

  const status: string = body.status === 'published' ? 'published' : 'draft'
  const article = await db.helpArticle.create({
    data: {
      slug,
      title: body.title.trim(),
      summary: body.summary?.trim() || null,
      body: body.body,
      videoUrl: body.videoUrl?.trim() || null,
      categoryId: body.categoryId || null,
      status,
      publishedAt: status === 'published' ? new Date() : null,
      authorEmail: email,
      order: typeof body.order === 'number' ? body.order : 0,
    },
  })
  return NextResponse.json({ article }, { status: 201 })
}
