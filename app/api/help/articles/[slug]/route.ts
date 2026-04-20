import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'

type Params = { params: Promise<{ slug: string }> }

/**
 * Single article by slug.
 *   GET    — public (only returns if published OR caller is super-admin)
 *   PATCH  — admin only
 *   DELETE — admin only
 */

export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const article = await db.helpArticle.findUnique({
    where: { slug },
    include: { category: true },
  })
  if (!article) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Hide drafts from the public. Super-admins can preview.
  if (article.status !== 'published') {
    const { ok } = await isSuperAdmin()
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Increment viewCount — best effort, doesn't block the response.
  db.helpArticle.update({
    where: { id: article.id },
    data: { viewCount: { increment: 1 } },
  }).catch(() => {})

  return NextResponse.json({ article })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const existing = await db.helpArticle.findUnique({ where: { slug } })
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // When toggling status to published for the first time, stamp publishedAt.
  // When flipping back to draft, keep the historical publishedAt so the
  // next re-publish doesn't reset ordering by publish date.
  let publishedAt = existing.publishedAt
  if (body.status === 'published' && !existing.publishedAt) publishedAt = new Date()

  const article = await db.helpArticle.update({
    where: { id: existing.id },
    data: {
      ...(body.title !== undefined && { title: String(body.title).trim() }),
      ...(body.summary !== undefined && { summary: body.summary?.trim() || null }),
      ...(body.body !== undefined && { body: body.body }),
      ...(body.videoUrl !== undefined && { videoUrl: body.videoUrl?.trim() || null }),
      ...(body.categoryId !== undefined && { categoryId: body.categoryId || null }),
      ...(body.status !== undefined && { status: body.status, publishedAt }),
      ...(body.order !== undefined && { order: Number(body.order) }),
      authorEmail: email,
    },
  })
  return NextResponse.json({ article })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const { ok } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await db.helpArticle.delete({ where: { slug } })
  return NextResponse.json({ success: true })
}
