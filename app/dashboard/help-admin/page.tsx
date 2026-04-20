import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { isSuperAdmin } from '@/lib/help-auth'
import CategoryManager from './CategoryManager'

/**
 * Admin landing for the help center. Server-renders the guard, the full
 * article list (including drafts), and the inline category manager. Form
 * interactions happen in client components below.
 *
 * Non-super-admins get bounced to the dashboard root — no leak, no 403.
 */

export const dynamic = 'force-dynamic'   // always fresh, never cached

export default async function HelpAdminPage() {
  const { ok, email } = await isSuperAdmin()
  if (!ok) redirect('/dashboard')

  const [articles, categories] = await Promise.all([
    db.helpArticle.findMany({
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
      include: { category: true },
    }),
    db.helpCategory.findMany({
      orderBy: [{ order: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { articles: true } } },
    }),
  ])

  const published = articles.filter(a => a.status === 'published')
  const drafts = articles.filter(a => a.status !== 'published')

  return (
    <div className="p-8 max-w-5xl space-y-10">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Help Center · Admin</h1>
          <p className="text-xs text-zinc-500 mt-1">
            Signed in as <span className="text-zinc-400 font-mono">{email}</span>.
            Changes are live instantly on{' '}
            <Link href="/help" className="text-blue-400 hover:text-blue-300 underline" target="_blank">/help</Link>.
          </p>
        </div>
        <Link
          href="/dashboard/help-admin/articles/new"
          className="inline-flex items-center rounded-lg bg-white text-black font-medium text-sm px-4 h-10 hover:bg-zinc-200 transition-colors"
        >
          + New article
        </Link>
      </header>

      {/* Categories */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">Categories</h2>
        <CategoryManager initialCategories={categories.map(c => ({
          id: c.id, slug: c.slug, name: c.name, description: c.description ?? '',
          icon: c.icon ?? '', order: c.order, articleCount: c._count.articles,
        }))} />
      </section>

      {/* Published */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Published <span className="text-zinc-600">· {published.length}</span>
        </h2>
        {published.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4">Nothing published yet.</p>
        ) : (
          <ArticleTable articles={published} />
        )}
      </section>

      {/* Drafts */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
          Drafts <span className="text-zinc-600">· {drafts.length}</span>
        </h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-zinc-500 py-4">No drafts.</p>
        ) : (
          <ArticleTable articles={drafts} />
        )}
      </section>
    </div>
  )
}

function ArticleTable({ articles }: { articles: any[] }) {
  return (
    <div className="rounded-xl border border-zinc-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-zinc-900/50 text-[10px] uppercase tracking-wider text-zinc-500">
          <tr>
            <th className="text-left px-4 py-2.5 font-semibold">Title</th>
            <th className="text-left px-4 py-2.5 font-semibold">Category</th>
            <th className="text-left px-4 py-2.5 font-semibold">Views</th>
            <th className="text-left px-4 py-2.5 font-semibold">Updated</th>
            <th className="text-right px-4 py-2.5 font-semibold">&nbsp;</th>
          </tr>
        </thead>
        <tbody>
          {articles.map(a => (
            <tr key={a.id} className="border-t border-zinc-800 hover:bg-zinc-900/40 transition-colors">
              <td className="px-4 py-2.5">
                <Link href={`/dashboard/help-admin/articles/${a.slug}`} className="text-zinc-100 hover:text-white">
                  {a.title}
                </Link>
                <div className="text-[11px] text-zinc-600 font-mono mt-0.5">/help/a/{a.slug}</div>
              </td>
              <td className="px-4 py-2.5 text-zinc-400 text-xs">
                {a.category ? a.category.name : <span className="text-zinc-600">—</span>}
              </td>
              <td className="px-4 py-2.5 text-zinc-400 text-xs">{a.viewCount}</td>
              <td className="px-4 py-2.5 text-zinc-500 text-xs">
                {new Date(a.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </td>
              <td className="px-4 py-2.5 text-right">
                <Link
                  href={`/help/a/${a.slug}`}
                  target="_blank"
                  className="text-xs text-blue-400 hover:text-blue-300 mr-4"
                >
                  View ↗
                </Link>
                <Link
                  href={`/dashboard/help-admin/articles/${a.slug}`}
                  className="text-xs text-zinc-400 hover:text-white"
                >
                  Edit
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
