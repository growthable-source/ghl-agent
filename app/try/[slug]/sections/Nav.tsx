import Link from 'next/link'
import XoveraLogo from '@/components/XoveraLogo'

/** Sticky top nav for the /try demo lander. Deliberately minimal — no
 *  announcement bar, no login link — this is a focused paid-traffic /
 *  cold-email lander, not the main marketing site.
 *
 *  checkoutMode 'embedded' opens PurchaseModal in-page; 'external' falls
 *  back to a plain link (real <a>, not a JS redirect, so it stays
 *  right-clickable/open-in-new-tab-able) until Ryan sets
 *  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY. */
export default function Nav({
  checkoutHref,
  checkoutMode,
  onOpenCheckout,
}: {
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
        <Link href="/" className="flex items-center shrink-0">
          <XoveraLogo height={24} />
        </Link>
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
            Get this for my business →
          </button>
        ) : (
          <a href={checkoutHref} className="btn-primary text-xs sm:text-sm py-2 px-4 sm:px-5 rounded-full shrink-0">
            Get this for my business →
          </a>
        )}
      </div>
    </nav>
  )
}
