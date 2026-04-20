import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import ArticleEditor from '../../ArticleEditor'

export const dynamic = 'force-dynamic'

export default async function NewArticlePage() {
  const { ok } = await isSuperAdmin()
  if (!ok) redirect('/dashboard')

  const categories = await db.helpCategory.findMany({
    orderBy: { name: 'asc' }, select: { id: true, name: true },
  })

  return (
    <div className="p-8 max-w-6xl space-y-6">
      <nav className="text-xs text-zinc-500">
        <Link href="/dashboard/help-admin" className="hover:text-white transition-colors">← Help admin</Link>
      </nav>
      <h1 className="text-xl font-semibold text-zinc-100">New article</h1>
      <ArticleEditor
        categories={categories}
        initial={{
          title: '',
          summary: '',
          body: '',
          videoUrl: '',
          categoryId: '',
          status: 'draft',
          order: 0,
        }}
      />
    </div>
  )
}
