import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import ArticleEditor from '../../ArticleEditor'

export const dynamic = 'force-dynamic'

export default async function EditArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { ok } = await isSuperAdmin()
  if (!ok) redirect('/dashboard')

  const { slug } = await params
  const article = await db.helpArticle.findUnique({ where: { slug } })
  if (!article) notFound()

  const categories = await db.helpCategory.findMany({
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  })

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <nav className="text-xs text-zinc-500 flex items-center justify-between">
        <Link href="/dashboard/help-admin" className="hover:text-white transition-colors">← Help admin</Link>
        <div className="flex items-center gap-3">
          <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded ${
            article.status === 'published'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
          }`}>
            {article.status}
          </span>
          <Link
            href={`/help/a/${article.slug}`}
            target="_blank"
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            View on site ↗
          </Link>
        </div>
      </nav>
      <h1 className="text-xl font-semibold text-zinc-100">Edit article</h1>
      <ArticleEditor
        existingSlug={article.slug}
        categories={categories}
        initial={{
          slug: article.slug,
          title: article.title,
          summary: article.summary ?? '',
          body: article.body,
          videoUrl: article.videoUrl ?? '',
          categoryId: article.categoryId ?? '',
          status: (article.status as 'draft' | 'published') ?? 'draft',
          order: article.order,
        }}
      />
    </div>
  )
}
