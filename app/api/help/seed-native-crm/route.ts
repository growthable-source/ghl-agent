import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import { NATIVE_CRM_CATEGORY, NATIVE_CRM_ARTICLES } from '@/lib/help-seed-native-crm'

/**
 * POST /api/help/seed-native-crm
 *
 * Creates (or reseeds) the "Native CRM" category and every article from
 * lib/help-seed-native-crm. Honours each article's `status` field —
 * articles default to 'draft' so they stay hidden from the public help
 * index until the matching dashboard UI is live. Bump an article's
 * status to 'published' in the seed file and rerun this route to flip
 * it live.
 *
 * Idempotent — keyed by slug, so editing a body and rerunning
 * republishes that article in place.
 *
 * Super-admin only.
 */
export async function POST() {
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden — super-admin only' }, { status: 403 })

  const category = await db.helpCategory.upsert({
    where: { slug: NATIVE_CRM_CATEGORY.slug },
    create: NATIVE_CRM_CATEGORY,
    update: NATIVE_CRM_CATEGORY,
  })

  let created = 0, updated = 0
  for (const a of NATIVE_CRM_ARTICLES) {
    const existing = await db.helpArticle.findUnique({ where: { slug: a.slug } })
    const status = a.status ?? 'draft'
    const data = {
      ...a,
      categoryId: category.id,
      status,
      // Only stamp publishedAt the first time an article goes live so
      // ordering stays stable across reseeds.
      publishedAt: status === 'published'
        ? (existing?.publishedAt ?? new Date())
        : null,
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
    totalArticles: NATIVE_CRM_ARTICLES.length,
    created,
    updated,
  })
}
