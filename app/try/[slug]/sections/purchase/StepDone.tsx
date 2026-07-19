import { Mail, PartyPopper, Phone } from 'lucide-react'

/**
 * PurchaseModal step 5 — done. `phoneNumber` is only ever populated when
 * this step was reached straight off the number/route.ts POST response
 * within the same session (per that route's doc comment: read it off the
 * POST response, not a later status poll — once state advances to
 * `complete`, the public projection intentionally stops surfacing it).
 * Reopening the modal after a purchase (localStorage resume in
 * PurchaseModal.tsx) lands here without a phoneNumber — the generic
 * "check your email" copy below covers that case gracefully.
 *
 * A working resend-magic-link endpoint doesn't exist yet (see the plan's
 * work order, task 5) — this is a static hint, not a button wired to a
 * route that would 404.
 */
export default function StepDone({
  businessName,
  phoneNumber,
  concierge,
  onShare,
  shareCopied,
}: {
  businessName: string
  phoneNumber: string | null
  concierge: boolean
  onShare: () => void
  shareCopied: boolean
}) {
  return (
    <div className="flex flex-col items-center text-center gap-5 py-4">
      <div className="h-14 w-14 rounded-full flex items-center justify-center" style={{ background: 'var(--accent-emerald-bg)' }}>
        <PartyPopper className="h-7 w-7" style={{ color: 'var(--accent-emerald)' }} />
      </div>

      <div>
        <h2 className="text-2xl font-bold mb-1.5" style={{ color: 'var(--text-primary)' }}>
          You&rsquo;re all set!
        </h2>
        <p className="text-sm max-w-sm" style={{ color: 'var(--text-secondary)' }}>
          {concierge
            ? `We're finishing a few setup details by hand for ${businessName} — you'll get a sign-in link by email shortly.`
            : `Check your email for a sign-in link to ${businessName}'s new dashboard.`}
        </p>
      </div>

      {phoneNumber && (
        <div className="vox-card px-5 py-4 flex items-center gap-3">
          <Phone className="h-5 w-5 shrink-0" style={{ color: 'var(--accent-primary)' }} />
          <div className="text-left">
            <p className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: 'var(--text-tertiary)' }}>Your new number</p>
            <p className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{phoneNumber}</p>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm flex flex-col gap-3 mt-2">
        <button type="button" onClick={onShare} className="btn-secondary w-full justify-center">
          {shareCopied ? 'Link copied!' : 'Share this with your team'}
        </button>
        <p className="flex items-center justify-center gap-1.5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
          <Mail className="h-3.5 w-3.5" />
          Didn&rsquo;t get it? Check spam, or reply to any of our emails and we&rsquo;ll help.
        </p>
      </div>
    </div>
  )
}
