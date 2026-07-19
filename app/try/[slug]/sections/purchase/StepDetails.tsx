/**
 * PurchaseModal step 1 — name + email, the abandoned-checkout remarketing
 * hook. Submitting POSTs checkout-session/route.ts, which persists
 * contactEmail immediately (before any payment) regardless of whether the
 * visitor ever reaches step 2.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function StepDetails({
  name,
  email,
  onNameChange,
  onEmailChange,
  onSubmit,
  submitting,
  error,
  fallbackHref,
}: {
  name: string
  email: string
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onSubmit: () => void
  submitting: boolean
  error: string | null
  /** Shown alongside `error` — the external DEMO_CHECKOUT_URL link so a
   *  server-side hiccup (e.g. Stripe prices not configured yet) never
   *  dead-ends a visitor who has the publishable key client-side but hit
   *  a 503/502 from checkout-session/route.ts. */
  fallbackHref?: string | null
}) {
  const emailValid = EMAIL_RE.test(email.trim())

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-xl font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
          Where should we send your setup details?
        </h2>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          We&rsquo;ll email your sign-in link the moment your account is ready.
        </p>
      </div>

      <form
        className="flex flex-col gap-4"
        onSubmit={e => {
          e.preventDefault()
          if (emailValid && !submitting) onSubmit()
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Name</span>
          <input
            type="text"
            value={name}
            onChange={e => onNameChange(e.target.value)}
            placeholder="Jane Smith"
            autoComplete="name"
            className="rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
            style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Email *</span>
          <input
            type="email"
            required
            value={email}
            onChange={e => onEmailChange(e.target.value)}
            placeholder="you@yourbusiness.com"
            autoComplete="email"
            className="rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2"
            style={{ background: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--input-text)' }}
          />
        </label>

        {error && (
          <p className="text-sm text-accent-red">
            {error}
            {fallbackHref && (
              <>
                {' '}
                <a href={fallbackHref} className="underline">Use our direct checkout link instead →</a>
              </>
            )}
          </p>
        )}

        <button
          type="submit"
          disabled={!emailValid || submitting}
          className="btn-primary w-full justify-center py-3.5 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'One moment…' : 'Continue to payment →'}
        </button>

        <p className="text-center text-xs" style={{ color: 'var(--text-tertiary)' }}>
          14-day money-back guarantee · Cancel anytime
        </p>
      </form>
    </div>
  )
}
