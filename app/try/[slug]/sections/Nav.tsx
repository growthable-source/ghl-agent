import Link from 'next/link'
import BrandLogo from '@/components/BrandLogo'
import type { DemoBrand } from '@/lib/demo-brands'

/** Sticky top nav for the /try demo lander. Deliberately minimal — no
 *  announcement bar, no login link — this is a focused paid-traffic /
 *  cold-email lander, not the main marketing site.
 *
 *  checkoutMode 'embedded' opens PurchaseModal in-page; 'external' falls
 *  back to a plain link (real <a>, not a JS redirect, so it stays
 *  right-clickable/open-in-new-tab-able) until Ryan sets
 *  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. */
export default function Nav({
  brand,
  checkoutHref,
  checkoutMode,
  onOpenCheckout,
}: {
  brand: DemoBrand
  checkoutHref: string
  checkoutMode: 'embedded' | 'external'
  onOpenCheckout: () => void
}) {
  return (
    <nav
      className="sticky top-0 z-40 backdrop-blur-xl border-b"
      style={{ background: 'color-mix(in srgb, var(--background) 85%, transparent)', borderColor: 'var(--border)' }}
    >
      <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 h-16">
        {/* Whitelabel brands point home at their own site (absolute URL),
            which Link shouldn't own — plain anchor + noopener for those. */}
        {brand.homeHref.startsWith('http') ? (
          <a href={brand.homeHref} target="_blank" rel="noopener noreferrer" className="flex items-center shrink-0">
            <BrandLogo brand={brand} height={brand.logoHeights.nav} />
          </a>
        ) : (
          <Link href={brand.homeHref} className="flex items-center shrink-0">
            <BrandLogo brand={brand} height={brand.logoHeights.nav} />
          </Link>
        )}
        <div className="hidden md:flex items-center gap-7">
          <a href="#features" className="text-sm font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
            Features
          </a>
          <a href="#how-it-works" className="text-sm font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
            How it works
          </a>
          <a href="#reviews" className="text-sm font-medium transition-colors hover:text-[var(--text-primary)]" style={{ color: 'var(--text-secondary)' }}>
            Reviews
          </a>
        </div>
        {checkoutMode === 'embedded' ? (
          <button type="button" onClick={onOpenCheckout} className="btn-primary text-xs sm:text-sm py-2 px-4 sm:px-5 rounded-full shrink-0">
            {brand.copy.navCta}
          </button>
        ) : (
          <a href={checkoutHref} className="btn-primary text-xs sm:text-sm py-2 px-4 sm:px-5 rounded-full shrink-0">
            {brand.copy.navCta}
          </a>
        )}
      </div>
    </nav>
  )
}
