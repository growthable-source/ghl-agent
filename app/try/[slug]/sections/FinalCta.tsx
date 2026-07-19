export default function FinalCta({
  checkoutHref,
  checkoutMode,
  onOpenCheckout,
  learnMoreHref,
}: {
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
            style={{ background: 'radial-gradient(ellipse at 50% 45%, rgba(232,68,37,0.12), transparent 70%)' }}
          />
          <div className="relative z-10 max-w-xl mx-auto">
            <p className="font-extrabold text-xs tracking-[0.2em] uppercase mb-4" style={{ color: 'var(--text-secondary)' }}>
              Never miss another call
            </p>
            <h2 className="font-black tracking-tight mb-5" style={{ fontSize: 'clamp(1.9rem, 4.5vw, 3.5rem)', color: 'var(--text-primary)' }}>
              Your AI receptionist is <span className="text-gradient">ready right now.</span>
            </h2>
            <p className="mb-9 leading-[1.65]" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
              No developers. No long setup. Paste your URL and your phone is covered — nights, weekends, every day.
            </p>
            {checkoutMode === 'embedded' ? (
              <button type="button" onClick={onOpenCheckout} className="btn-primary text-lg py-4 px-10 rounded-full">
                📞 Get My AI Receptionist →
              </button>
            ) : (
              <a href={checkoutHref} className="btn-primary text-lg py-4 px-10 rounded-full">
                📞 Get My AI Receptionist →
              </a>
            )}
            <p className="mt-5">
              <a href={learnMoreHref} className="text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>
                Watch a 2-min explainer
              </a>
            </p>
            <p className="mt-6 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              14-day money-back guarantee · Cancel anytime
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
