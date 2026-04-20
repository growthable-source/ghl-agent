import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const c = await db.helpCategory.findUnique({ where: { slug } })
  return c ? { title: `${c.name} — Voxility Help`, description: c.description ?? undefined } : {}
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const category = await db.helpCategory.findUnique({
    where: { slug },
    include: {
      articles: {
        where: { status: 'published' },
        orderBy: [{ order: 'asc' }, { publishedAt: 'desc' }],
      },
    },
  })
  if (!category) notFound()

  return (
    <div className="space-y-6 max-w-3xl">
      <nav className="text-xs text-zinc-500">
        <Link href="/help" className="hover:text-white transition-colors">Help Center</Link>
        <span className="mx-2 text-zinc-700">/</span>
        <span className="text-zinc-400">{category.name}</span>
      </nav>

      <header>
        <div className="flex items-center gap-3">
          {category.icon && <span className="text-3xl">{category.icon}</span>}
          <h1 className="text-2xl font-bold text-zinc-50">{category.name}</h1>
        </div>
        {category.description && <p className="text-zinc-400 mt-2">{category.description}</p>}
      </header>

      {category.articles.length === 0 ? (
        <p className="text-sm text-zinc-500 py-8">No published articles in this category yet.</p>
      ) : (
        <div className="space-y-2">
          {category.articles.map(a => (
            <Link
              key={a.id}
              href={`/help/a/${a.slug}`}
              className="block rounded-lg border border-zinc-800 hover:border-zinc-600 bg-zinc-950 px-4 py-3 transition-colors"
            >
              <div className="text-sm text-zinc-100">{a.title}</div>
              {a.summary && <p className="text-xs text-zinc-500 mt-0.5 line-clamp-2">{a.summary}</p>}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
