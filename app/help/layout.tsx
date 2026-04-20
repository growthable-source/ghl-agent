import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

/**
 * Public help-center chrome. Intentionally separate from the dashboard
 * layout — this route is crawlable and must render for unauthenticated
 * visitors (and external crawlers pulling the JSON feed).
 */
export const metadata = {
  title: 'Help Center — Voxility',
  description: 'Guides, videos and reference for the Voxility conversational AI platform.',
  robots: { index: true, follow: true },
}

export default function HelpLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <header className="sticky top-0 z-40 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/help" className="flex items-center gap-2.5">
            <VoxilityLogo variant="mark" height={22} />
            <span className="font-semibold text-sm">Voxility Help</span>
          </Link>
          <div className="flex items-center gap-5 text-xs">
            <Link href="/login" className="text-zinc-400 hover:text-white transition-colors">Dashboard</Link>
            <Link href="/support" className="text-zinc-400 hover:text-white transition-colors">Contact support</Link>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-6 py-10">{children}</main>
      <footer className="border-t border-zinc-900 mt-16 py-8">
        <div className="max-w-5xl mx-auto px-6 text-xs text-zinc-600 flex items-center justify-between">
          <span>© {new Date().getFullYear()} Voxility</span>
          <div className="flex items-center gap-4">
            <Link href="/help/api/articles" className="hover:text-zinc-400 transition-colors">JSON feed</Link>
            <Link href="/help/sitemap.xml" className="hover:text-zinc-400 transition-colors">Sitemap</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
