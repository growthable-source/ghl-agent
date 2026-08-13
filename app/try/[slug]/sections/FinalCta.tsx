import type { DemoBrand } from '@/lib/demo-brands'

export default function FinalCta({
  brand,
  checkoutHref,
  checkoutMode,
  onOpenCheckout,
  learnMoreHref,
}: {
  brand: DemoBrand
  checkoutHref: string
  checkoutMode: 'embedded' | 'external'
  onOpenCheckout: () => void
  learnMoreHref: string
}) {
  return (
    <section className="py-16 sm:py-20 px-6">
      <div className="max-w-[1280px] mx-auto">
        <div
          className="relative overflow-hidden rounded-3xl border text-center px-6 sm:px-12 py-16 sm:py-20"
          style={{ background: 'var(--surface-secondary)', borderColor: 'var(--border)' }}
        >
          <div
            className="absolute left-1/2 -translate-x-1/2 -top-10 w-[560px] h-[360px] pointer-events-none"
            style={{ background: 'radial-gradient(ellipse at 50% 45%, color-mix(in srgb, var(--accent-primary) 12%, transparent), transparent 70%)' }}
          />
          <div className="relative z-10 max-w-xl mx-auto">
            <p className="font-extrabold text-xs tracking-[0.2em] uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>
              {brand.copy.finalCtaEyebrow}
            </p>
            <h2 className="font-black tracking-tight mb-5" style={{ fontSize: 'clamp(1.9rem, 4.5vw, 3.5rem)', color: 'var(--text-primary)' }}>
              {brand.copy.finalCtaHeadingLead}
              <span className="text-gradient">{brand.copy.finalCtaHeadingAccent}</span>
            </h2>
            <p className="mb-9 leading-[1.65]" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
              {brand.copy.finalCtaBody}
            </p>
            {checkoutMode === 'embedded' ? (
              <button type="button" onClick={onOpenCheckout} className="btn-primary text-lg py-4 px-10 rounded-full">
                {brand.copy.finalCtaButton}
              </button>
            ) : (
              <a href={checkoutHref} className="btn-primary text-lg py-4 px-10 rounded-full">
                {brand.copy.finalCtaButton}
              </a>
            )}
            <p className="mt-5">
              <a href={learnMoreHref} className="text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>
                {brand.copy.finalCtaLearnMore}
              </a>
            </p>
            <p className="mt-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              {brand.copy.finalCtaFootnote}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
