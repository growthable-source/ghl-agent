import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * Help article search. ILIKE across title / summary / body, published only.
 *
 * MVP — simple and bounded (limit 20). If the corpus grows past a few
 * hundred articles we'll want proper full-text search (Postgres tsvector
 * or an external index). For a help center that's fine for a long while.
 */

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  if (!q) return NextResponse.json({ results: [] })

  const results = await db.helpArticle.findMany({
    where: {
      status: 'published',
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
        { body: { contains: q, mode: 'insensitive' } },
      ],
    },
    orderBy: { updatedAt: 'desc' },
    include: { category: true },
    take: 20,
  })
  return NextResponse.json({ results })
}
