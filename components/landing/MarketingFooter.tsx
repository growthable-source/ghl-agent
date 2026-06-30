import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'
import EmailCaptureForm from './EmailCaptureForm'

/**
 * Shared marketing-site footer (soft-light): launch-update email capture +
 * an internal-link column block (good for crawlability / internal linking
 * across the new SEO pages) + brand row.
 */
function Col({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <ul className="space-y-1.5" style={{ color: 'var(--text-secondary)' }}>{children}</ul>
    </div>
  )
}

function FooterLink({ href, children, external }: { href: string; children: React.ReactNode; external?: boolean }) {
  if (external) {
    return (
      <li>
        <a href={href} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-[var(--text-primary)]">{children}</a>
      </li>
    )
  }
  return (
    <li>
      <Link href={href} className="transition-colors hover:text-[var(--text-primary)]">{children}</Link>
    </li>
  )
}

export default function MarketingFooter({ minimal = false }: { minimal?: boolean }) {
  // Minimal footer for focused landers (e.g. paid-traffic niche pages): no
  // link columns or newsletter that would funnel visitors off the page —
  // just brand + the legally-required links.
  if (minimal) {
    return (
      <footer className="border-t mt-24 py-8 px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          <XoveraLogo height={16} />
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="transition-colors hover:text-[var(--text-primary)]">Privacy</Link>
            <Link href="/terms" className="transition-colors hover:text-[var(--text-primary)]">Terms</Link>
            <span>© Xovera</span>
          </div>
        </div>
      </footer>
    )
  }

  return (
    <footer className="border-t mt-24 py-10 px-6" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 pb-8 mb-8 border-b" style={{ borderColor: 'var(--border)' }}>
          <div>
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>Get launch updates</p>
            <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>One short email when something worth knowing ships.</p>
          </div>
          <EmailCaptureForm source="footer" cta="Subscribe" />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8 text-sm">
          <Col title="Product">
            <FooterLink href="/#features">Features</FooterLink>
            <FooterLink href="/#copilot">Co-Pilot</FooterLink>
            <FooterLink href="/integrations">Integrations</FooterLink>
            <FooterLink href="/services">Services</FooterLink>
            <FooterLink href="/login?mode=signup">Get started</FooterLink>
          </Col>
          <Col title="Solutions">
            <FooterLink href="/ai-customer-service">AI customer service</FooterLink>
            <FooterLink href="/ai-chat-widget-builder">AI chat widget builder</FooterLink>
            <FooterLink href="/ai-receptionist">AI receptionist</FooterLink>
            <FooterLink href="/ai-sdr">AI SDR</FooterLink>
            <FooterLink href="/ai-for-gyms">AI for gyms</FooterLink>
          </Col>
          <Col title="Alternatives">
            <FooterLink href="/intercom-alternative">Intercom alternative</FooterLink>
            <FooterLink href="/fin-alternative">Fin alternative</FooterLink>
            <FooterLink href="/zendesk-ai-alternative">Zendesk AI alternative</FooterLink>
            <FooterLink href="/alternatives">All alternatives</FooterLink>
          </Col>
          <Col title="Company">
            <FooterLink href="/blog">Blog</FooterLink>
            <FooterLink href="/compare">Compare</FooterLink>
            <FooterLink href="/help">Help</FooterLink>
            <FooterLink href="https://xovera.canny.io" external>Feedback</FooterLink>
          </Col>
        </div>

        <div className="flex items-center justify-between text-xs pt-2" style={{ color: 'var(--text-muted)' }}>
          <XoveraLogo height={16} />
          <span>© Xovera — Conversational AI for sales &amp; marketing teams</span>
        </div>
      </div>
    </footer>
  )
}
