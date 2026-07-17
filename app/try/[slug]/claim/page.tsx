/**
 * Auth-gated claim step. The /try page's primary CTA links here; an
 * unauthenticated prospect bounces through /login and lands back here
 * via callbackUrl. On success we go straight to billing — the demo
 * they just talked to is now their real agent, and the plan picker
 * (voice-inclusive plans) is the next screen.
 */
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { claimProspect } from '@/lib/demo-prospects/claim'

export const metadata = { robots: { index: false, follow: false } }

type Params = { params: Promise<{ slug: string }> }

export default async function ClaimPage({ params }: Params) {
  const { slug } = await params
  const session = await auth()
  if (!session?.user?.id) {
    redirect(`/login?callbackUrl=${encodeURIComponent(`/try/${slug}/claim`)}`)
  }

  const result = await claimProspect(slug, session.user.id)
  if (result.ok) {
    // Only send them to billing when there's actually a demo agent riding
    // along — an expired-before-claim demo still creates the workspace
    // (name prefilled from the prospect), but there's no "your demo is in
    // there" story to sell on the billing page, so land on the dashboard
    // instead.
    if (result.hadAgent) {
      redirect(`/dashboard/${result.workspaceId}/settings/billing?fromDemo=1`)
    }
    redirect(`/dashboard/${result.workspaceId}?fromDemo=expired`)
  }

  return (
    <main className="min-h-screen bg-black text-zinc-100 flex items-center justify-center px-6">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-semibold">
          {result.reason === 'claimed_by_other'
            ? 'This demo has already been claimed'
            : 'This demo link isn’t valid anymore'}
        </h1>
        <p className="text-zinc-400">
          You can still get an AI receptionist for your business in minutes.
        </p>
        <Link
          href="/ai-receptionist"
          className="inline-block rounded-lg px-6 py-3 font-semibold hover:opacity-90 transition"
          style={{ background: 'var(--accent-primary)', color: 'var(--btn-primary-text)' }}
        >
          See how it works
        </Link>
      </div>
    </main>
  )
}
