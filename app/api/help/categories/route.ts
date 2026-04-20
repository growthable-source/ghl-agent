import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'

function slugify(s: string): string {
  return s.toLowerCase().trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60)
}

export async function GET() {
  const categories = await db.helpCategory.findMany({
    orderBy: [{ order: 'asc' }, { name: 'asc' }],
    include: {
      // Only count published articles so the public landing doesn't leak
      // draft counts.
      _count: { select: { articles: { where: { status: 'published' } } } },
    },
  })
  return NextResponse.json({ categories })
}

export async function POST(req: NextRequest) {
  const { ok } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  let slug = (body.slug && slugify(body.slug)) || slugify(body.name)
  let suffix = 1
  // eslint-disable-next-line no-await-in-loop
  while (await db.helpCategory.findUnique({ where: { slug } })) {
    suffix++
    slug = `${slugify(body.slug || body.name)}-${suffix}`
  }

  const category = await db.helpCategory.create({
    data: {
      slug,
      name: body.name.trim(),
      description: body.description?.trim() || null,
      icon: body.icon?.trim() || null,
      order: typeof body.order === 'number' ? body.order : 0,
    },
  })
  return NextResponse.json({ category }, { status: 201 })
}
