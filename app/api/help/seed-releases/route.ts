import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import { RELEASES_CATEGORY, RELEASES_ARTICLES } from '@/lib/help-seed-releases'

/**
 * POST /api/help/seed-releases
 *
 * Creates (or reseeds) the "What's new" / Releases category and every
 * article under it from lib/help-seed-releases. Idempotent — keyed by
 * slug, so editing a body and rerunning republishes that article in place.
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

  return NextResponse.json({
    ok: true,
    category: category.slug,
    totalArticles: RELEASES_ARTICLES.length,
    created,
    updated,
  })
}
