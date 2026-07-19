/**
 * GET /welcome/[token] — landing page for the post-purchase magic-sign-in
 * email (lib/demo-purchase/magic-link.ts / lib/demo-purchase/fulfill.ts).
 *
 * Read-only: calls `peekMagicLinkToken`, which validates WITHOUT
 * consuming the row. This is deliberate — corporate mail-scanners
 * pre-fetch links inside emails, and a GET that consumed the token would
 * burn it before the buyer ever clicked. The actual sign-in happens on
 * the button's POST to /api/auth/demo-session, which single-use-consumes
 * it and sets the session cookie.
 *
 * Styled per the soft-light landing conventions used across
 * app/try/[slug]/sections/* — data-theme="soft-light", .vox-card,
 * .btn-primary/.btn-secondary, no bg-white (see CLAUDE.md's theme-token
 * rule: raw bg-white renders as brand-orange in this app).
 */
import { peekMagicLinkToken } from '@/lib/demo-purchase/magic-link'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Sign in — Xovera',
  robots: { index: false, follow: false },
}

export default async function WelcomePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const check = await peekMagicLinkToken(token)

  return (
    <div
      data-theme="soft-light"
      className="min-h-screen flex items-center justify-center px-6"
      style={{ background: 'var(--background)', color: 'var(--foreground)' }}
    >
      <div className="vox-card w-full max-w-md p-8 text-center flex flex-col items-center gap-4">
        {check.ok ? (
          <>
            <p className="text-3xl">🎉</p>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              You&rsquo;re in
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              Click below to sign in and see your AI receptionist live in the dashboard.
            </p>
            <form method="POST" action="/api/auth/demo-session" className="w-full">
              <input type="hidden" name="token" value={token} />
              <button type="submit" className="btn-primary w-full justify-center text-lg py-4">
                Sign in to your dashboard
              </button>
            </form>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
              This link can only be used once.
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl">{check.reason === 'expired' ? '⏱️' : '🔒'}</p>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
              {check.reason === 'expired' ? 'This link has expired' : 'This link has already been used'}
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>
              {check.reason === 'expired'
                ? "Sign-in links are only good for 24 hours. Contact us and we'll send you a fresh one."
                : "If you already signed in, head to your dashboard — otherwise contact us and we'll send a fresh link."}
            </p>
            <a href="mailto:support@xovera.io" className="btn-secondary w-full justify-center">
              Contact support
            </a>
          </>
        )}
      </div>
    </div>
  )
}
