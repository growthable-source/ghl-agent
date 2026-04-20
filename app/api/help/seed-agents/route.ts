import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import { AGENTS_CATEGORY, AGENTS_ARTICLES } from '@/lib/help-seed-agents'

/**
 * POST /api/help/seed-agents
 *
 * Creates (or reseeds) the "Agents" category and every article under it
 * from lib/help-seed-agents. Idempotent — keyed by slug so running twice
 * updates in place. Super-admin only; this re-publishes content.
 *
 * Run it after editing lib/help-seed-agents.ts to push changes live
 * without clicking through the admin UI 17 times.
 */
export async function POST() {
  const { ok, email } = await isSuperAdmin()
  if (!ok) return NextResponse.json({ error: 'Forbidden — super-admin only' }, { status: 403 })

  const category = await db.helpCategory.upsert({
    where: { slug: AGENTS_CATEGORY.slug },
    create: AGENTS_CATEGORY,
    update: AGENTS_CATEGORY,
  })

  let created = 0, updated = 0
  for (const a of AGENTS_ARTICLES) {
    const existing = await db.helpArticle.findUnique({ where: { slug: a.slug } })
    const data = {
      ...a,
      categoryId: category.id,
      status: 'published',
      // Preserve the original publish date so ordering stays stable on reseeds.
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
    totalArticles: AGENTS_ARTICLES.length,
    created,
    updated,
  })
}
