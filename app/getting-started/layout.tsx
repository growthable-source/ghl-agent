import Link from 'next/link'
import VoxilityLogo from '@/components/VoxilityLogo'

/**
 * Public chrome for the Getting Started page. Matches the help-center
 * layout's pattern so the two read as siblings — both are crawlable,
 * both render for unauthenticated visitors. Intentionally separate
 * from the dashboard chrome (which is auth-gated by middleware on
 * /dashboard/*).
 */
export const metadata = {
  title: 'Getting started with Voxility — Conversational AI for your CRM',
  description:
    'Voxility runs AI agents on top of your CRM — SMS, WhatsApp, Email, Live Chat, Voice. Here\'s the four-step setup, the core concepts, and the example agents to copy.',
  robots: { index: true, follow: true },
}

export default function GettingStartedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ background: 'var(--background)', color: 'var(--text-primary)' }}>
      <header
        className="sticky top-0 z-40 backdrop-blur"
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'color-mix(in oklab, var(--background) 85%, transparent)',
        }}
      >
        <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <VoxilityLogo variant="mark" height={22} />
            <span className="font-semibold text-sm">Voxility</span>
          </Link>
          <nav className="flex items-center gap-5 text-xs">
            <Link href="/help" className="hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)' }}>
              Help center
            </Link>
            <Link href="/support" className="hover:opacity-80 transition-opacity" style={{ color: 'var(--text-tertiary)' }}>
              Support
            </Link>
            <Link
              href="/login"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
              style={{ background: '#fa4d2e', color: '#ffffff' }}
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main>{children}</main>

      <footer
        className="mt-16 py-8"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <div
          className="max-w-5xl mx-auto px-6 text-xs flex items-center justify-between"
          style={{ color: 'var(--text-muted)' }}
        >
          <span>© {new Date().getFullYear()} Voxility</span>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:opacity-80 transition-opacity">Privacy</Link>
            <Link href="/terms" className="hover:opacity-80 transition-opacity">Terms</Link>
            <Link href="/help" className="hover:opacity-80 transition-opacity">Help center</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
