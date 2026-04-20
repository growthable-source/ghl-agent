import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { Markdown } from '@/lib/help-markdown'

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const a = await db.helpArticle.findUnique({ where: { slug } })
  if (!a || a.status !== 'published') return {}
  return {
    title: `${a.title} — Voxility Help`,
    description: a.summary ?? undefined,
    openGraph: { title: a.title, description: a.summary ?? undefined, type: 'article' },
  }
}

/**
 * Convert a YouTube / Vimeo / mp4 URL into the right embed markup. If we
 * can't parse it we fall back to a plain link so the article stays useful.
 */
function VideoEmbed({ url }: { url: string }) {
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{6,})/)
  if (yt) return (
    <div className="relative w-full aspect-video my-6 rounded-lg overflow-hidden border border-zinc-800">
      <iframe
        src={`https://www.youtube.com/embed/${yt[1]}`}
        title="Help video"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    </div>
  )
  const vimeo = url.match(/vimeo\.com\/(\d+)/)
  if (vimeo) return (
    <div className="relative w-full aspect-video my-6 rounded-lg overflow-hidden border border-zinc-800">
      <iframe
        src={`https://player.vimeo.com/video/${vimeo[1]}`}
        title="Help video"
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        className="absolute inset-0 w-full h-full"
      />
    </div>
  )
  if (/\.(mp4|webm|ogg)$/i.test(url)) return (
    <video
      src={url}
      controls
      className="w-full my-6 rounded-lg border border-zinc-800 bg-black"
    />
  )
  return (
    <p className="my-6">
      <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300 underline text-sm">
        Watch the video →
      </a>
    </p>
  )
}

export default async function ArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const article = await db.helpArticle.findUnique({
    where: { slug },
    include: { category: true },
  })
  if (!article || article.status !== 'published') notFound()

  // Fire-and-forget view count — best effort, never blocks the render.
  db.helpArticle.update({ where: { id: article.id }, data: { viewCount: { increment: 1 } } }).catch(() => {})

  return (
    <article className="max-w-3xl">
      <nav className="text-xs text-zinc-500 mb-6">
        <Link href="/help" className="hover:text-white transition-colors">Help Center</Link>
        {article.category && (
          <>
            <span className="mx-2 text-zinc-700">/</span>
            <Link href={`/help/c/${article.category.slug}`} className="hover:text-white transition-colors">
              {article.category.name}
            </Link>
          </>
        )}
      </nav>

      <header className="mb-8 pb-6 border-b border-zinc-900">
        <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">{article.title}</h1>
        {article.summary && <p className="text-lg text-zinc-400 mt-3 leading-relaxed">{article.summary}</p>}
        {article.publishedAt && (
          <p className="text-xs text-zinc-600 mt-4">
            Updated {new Date(article.updatedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        )}
      </header>

      {article.videoUrl && <VideoEmbed url={article.videoUrl} />}

      <div className="help-article">
        <Markdown source={article.body} />
      </div>
    </article>
  )
}
