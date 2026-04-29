import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import { BRANDS_CATEGORY, BRANDS_ARTICLES } from '@/lib/help-seed-brands'

/**
 * POST /api/help/seed-brands
 *
 * Creates (or reseeds) the "Brands" help category and every article
 * under it from lib/help-seed-brands. Idempotent — keyed by article
 * slug, so editing a body and rerunning republishes that article in
 * place.
 *
 * Articles whose slugs were *removed* from the seed file are deleted
 * from the DB so the category index doesn't leak stale content.
 * Scoped to articles inside this category — articles in other
 * categories are untouched.
 *
 * Super-admin only.
 */
export async function POST() {
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden — super-admin only' }, { status: 403 })

  const category = await db.helpCategory.upsert({
    where: { slug: BRANDS_CATEGORY.slug },
    create: BRANDS_CATEGORY,
    update: BRANDS_CATEGORY,
  })

  const liveSlugs = new Set(BRANDS_ARTICLES.map(a => a.slug))

  let created = 0, updated = 0
  for (const a of BRANDS_ARTICLES) {
    const existing = await db.helpArticle.findUnique({ where: { slug: a.slug } })
    const data = {
      ...a,
      categoryId: category.id,
      status: 'published',
      publishedAt: existing?.publishedAt ?? new Date(),
      authorEmail: email ?? 'seed@voxility.ai',
    }
    if (existing) {
      await db.helpArticle.update({ where: { id: existing.id }, data })
      updated++
    } else {
      await db.helpArticle.create({ data })
      created++
    }
  }

  // Prune retired slugs from this category — anything in Brands that
  // isn't in the seed file anymore.
  const stale = await db.helpArticle.findMany({
    where: { categoryId: category.id, slug: { notIn: Array.from(liveSlugs) } },
    select: { id: true, slug: true },
  })
  let deleted = 0
  for (const s of stale) {
    await db.helpArticle.delete({ where: { id: s.id } })
    deleted++
  }

  return NextResponse.json({
    ok: true,
    category: category.slug,
    totalArticles: BRANDS_ARTICLES.length,
    created,
    updated,
    deleted,
    deletedSlugs: stale.map(s => s.slug),
  })
}
