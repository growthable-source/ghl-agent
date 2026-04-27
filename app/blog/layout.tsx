import Link from 'next/link'
import type { Metadata } from 'next'
import VoxilityLogo from '@/components/VoxilityLogo'

export const metadata: Metadata = {
  title: {
    default: 'Blog',
    template: '%s | Voxility Blog',
  },
  description: 'Guides, comparisons, and product updates from the team building the self-improving AI agent platform for GoHighLevel and HubSpot.',
  alternates: { canonical: '/blog' },
}

/**
 * Shared blog chrome: top nav + footer. Deliberately thin so individual
 * posts can choose their own max-width / rhythm. Matches the landing
 * page's visual language (navy background, orange accent) so clicking
 * from marketing → blog → marketing feels like one site.
 */
export default function BlogLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: '#05080f', color: '#f8fafc' }}>
      <nav className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ background: 'rgba(5,8,15,0.92)', borderColor: 'rgba(18,26,43,0.8)' }}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center">
            <VoxilityLogo height={26} />
          </Link>
          <div className="hidden md:flex items-center gap-8 text-sm">
            <Link href="/" className="transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Home</Link>
            <Link href="/blog" className="transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Blog</Link>
            <Link href="/compare" className="transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Compare</Link>
            <Link href="/help" className="transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Help</Link>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm transition-colors hover:text-white" style={{ color: '#94a3b8' }}>Log in</Link>
            <Link href="/login?mode=signup" className="btn-primary text-sm py-2 px-5">Get started</Link>
          </div>
        </div>
      </nav>

      <main>{children}</main>

      <footer className="border-t mt-24 py-8 px-6" style={{ borderColor: '#121a2b' }}>
        <div className="max-w-[1200px] mx-auto flex items-center justify-between text-xs" style={{ color: '#475569' }}>
          <VoxilityLogo height={16} />
          <div className="flex items-center gap-6">
            <Link href="/blog/rss.xml" className="hover:text-white transition-colors">RSS</Link>
            <a href="https://voxility.canny.io" target="_blank" rel="noopener noreferrer" className="hover:text-white transition-colors">Feedback</a>
            <Link href="/login" className="hover:text-white transition-colors">Log in</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
