import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import { RELEASES_CATEGORY, RELEASES_ARTICLES } from '@/lib/help-seed-releases'

/**
 * POST /api/help/seed-releases
 *
 * Creates (or reseeds) the "What's new" / Releases category and every
 * article under it from lib/help-seed-releases. Idempotent — keyed by
 * slug, so editing a body and rerunning republishes that article in
 * place.
 *
 * Articles whose slugs were *removed* from the seed file (e.g. an
 * intermediate-state release note that's been replaced by a cleaner
 * write-up) are deleted from the DB so the public help index doesn't
 * leak stale content. Scoped to articles inside the Releases category
 * only — articles in other categories are untouched.
 *
 * Super-admin only.
 */
export async function POST() {
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden — super-admin only' }, { status: 403 })

  const category = await db.helpCategory.upsert({
    where: { slug: RELEASES_CATEGORY.slug },
    create: RELEASES_CATEGORY,
    update: RELEASES_CATEGORY,
  })

  const liveSlugs = new Set(RELEASES_ARTICLES.map(a => a.slug))

  let created = 0, updated = 0
  for (const a of RELEASES_ARTICLES) {
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

  // Prune retired slugs — anything in the Releases category that
  // isn't in the seed file anymore. Hard delete is fine for release
  // notes; we don't keep history of intermediate-state articles.
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
    totalArticles: RELEASES_ARTICLES.length,
    created,
    updated,
    deleted,
    deletedSlugs: stale.map(s => s.slug),
  })
}
