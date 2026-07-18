/** Post-call conversion modal — opens the moment a call ends (the
 *  emotional peak), dismissible, reopenable from the hero CTA row. */
export default function ConversionModal({
  businessName,
  checkoutHref,
  shareCopied,
  onShare,
  onClose,
}: {
  businessName: string
  checkoutHref: string
  shareCopied: boolean
  onShare: () => void
  onClose: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-6"
      role="dialog"
      aria-modal="true"
      aria-label={`Get this for ${businessName}`}
    >
      <button aria-label="Close" onClick={onClose} className="absolute inset-0" style={{ background: 'rgba(28,25,23,0.6)' }} />
      <div className="vox-card relative w-full max-w-md p-8 text-center flex flex-col items-center gap-4" style={{ boxShadow: '0 20px 60px rgba(28,25,23,0.3)' }}>
        <p className="text-3xl">🎉</p>
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          That was YOUR receptionist.
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Want it answering {businessName}&rsquo;s phone 24/7 — nights, weekends, every missed call?
        </p>
        <a href={checkoutHref} className="btn-primary w-full justify-center text-lg py-4">
          Yes — I want this for my business
        </a>
        <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
          14-day free trial · No credit card required · Cancel anytime
        </p>
        <button type="button" onClick={onShare} className="btn-secondary w-full justify-center">
          {shareCopied ? 'Link copied — send it over!' : 'Not your call to make? Share it with the decision maker'}
        </button>
        <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--text-tertiary)' }}>
          Maybe later
        </button>
      </div>
    </div>
  )
}
