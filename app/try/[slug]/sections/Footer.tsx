import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'
import type { DemoBrand } from '@/lib/demo-brands'

export default function Footer({
  brand,
  businessName,
  onShare,
  shareCopied,
}: {
  brand: DemoBrand
  businessName: string
  onShare: () => void
  shareCopied: boolean
}) {
  const external = brand.homeHref.startsWith('http')
  return (
    <footer className="border-t py-8 px-6" style={{ borderColor: 'var(--border)' }}>
      <div className="max-w-[1280px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
        <div className="flex items-center gap-3">
          <BrandLogo brand={brand} height={brand.logoHeights.footer} />
          <span>
            Demo built by{' '}
            {external ? (
              <a href={brand.homeHref} target="_blank" rel="noopener noreferrer" className="underline hover:no-underline">
                {brand.name}
              </a>
            ) : (
              <Link href={brand.homeHref} className="underline hover:no-underline">
                {brand.name}
              </Link>
            )}
            . {brand.copy.footerAttribution(businessName)}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Link href={brand.legal.privacyHref} className="transition-colors hover:text-[var(--text-primary)]">Privacy</Link>
          <Link href={brand.legal.termsHref} className="transition-colors hover:text-[var(--text-primary)]">Terms</Link>
          <button type="button" onClick={onShare} className="transition-colors hover:text-[var(--text-primary)]">
            {shareCopied ? 'Link copied!' : '↗ Share this demo'}
          </button>
        </div>
      </div>
    </footer>
  )
}
