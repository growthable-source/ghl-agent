import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'
import AnnouncementBar from './AnnouncementBar'

/**
 * Shared marketing-site top nav (soft-light). Includes the dismissible
 * announcement bar so every public page carries the promo + consistent
 * chrome. Pages can pass their own `links` (the homepage uses in-page
 * anchors; other pages use the cross-page defaults).
 */
export type NavLink = { href: string; label: string }

const DEFAULT_LINKS: NavLink[] = [
  { href: '/#features', label: 'Features' },
  { href: '/integrations', label: 'Integrations' },
  { href: '/services', label: 'Services' },
  { href: '/alternatives', label: 'Alternatives' },
  { href: '/blog', label: 'Blog' },
]

export default function MarketingNav({ links = DEFAULT_LINKS }: { links?: NavLink[] }) {
  return (
    <>
      <AnnouncementBar />
      <nav className="sticky top-0 z-50 backdrop-blur-xl border-b" style={{ background: 'rgba(248,247,244,0.85)', borderColor: 'var(--border)' }}>
        <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 h-16">
          <Link href="/" className="flex items-center">
            <XoveraLogo height={28} />
          </Link>
          <div className="hidden md:flex items-center gap-7">
            {links.map((l) => (
              <Link key={l.href + l.label} href={l.href} className="text-sm font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
                {l.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
              Log in
            </Link>
            <Link href="/login?mode=signup" className="btn-primary text-sm py-2 px-5">
              Get started
            </Link>
          </div>
        </div>
      </nav>
    </>
  )
}
