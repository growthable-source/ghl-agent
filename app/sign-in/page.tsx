/**
 * White-label team sign-in — https://<workspace domain>/sign-in.
 *
 * The workspace's own staff (owners, admins, members, support agents)
 * sign in here with a one-time code emailed to them, then use the
 * dashboard on the same domain, branded as the workspace
 * (lib/whitelabel/*). Branding (logo, accent, heading, message) is set by
 * a platform admin under Settings → Custom domain.
 *
 * Only served on an active white-label workspace domain: on our hosts it
 * sends people to the normal /login, on any other custom host it 404s.
 */

import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { customHostOrigin, resolveTeamBrand } from '@/lib/domains/host-brand'
import { brandMetadata, brandedPageTitle } from '@/lib/domains/brand-metadata'
import { safeCallbackPath } from '@/lib/whitelabel/login-code'
import SignInForm from './SignInForm'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const host = (await headers()).get('host')
  const brand = await resolveTeamBrand(host)
  if (!brand) return { robots: { index: false, follow: false } }
  const resolved = { name: brand.name, iconUrl: brand.logoUrl, accent: brand.accent }
  return { ...brandMetadata(resolved, customHostOrigin(host)), title: brandedPageTitle(resolved, 'Sign in') }
}

type SearchParams = Promise<{ error?: string; callbackUrl?: string; email?: string }>

export default async function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  const host = (await headers()).get('host')
  const brand = await resolveTeamBrand(host)
  if (!brand) {
    // Our own host → the normal sign-in. Any other custom host (portal,
    // locked or pending domain) has no team page; /login there would
    // bounce straight back here.
    if (customHostOrigin(host)) notFound()
    redirect('/login')
  }

  const sp = await searchParams
  const callbackUrl = safeCallbackPath(sp.callbackUrl, brand.workspaceId)

  // Already signed in as a team member → straight to work.
  const session = await auth()
  if (session?.user?.id && sp.error !== 'no_access') {
    const member = await db.workspaceMember.findUnique({
      where: { userId_workspaceId: { userId: session.user.id, workspaceId: brand.workspaceId } },
      select: { role: true },
    })
    if (member) {
      redirect(callbackUrl ?? (member.role === 'agent'
        ? `/dashboard/${brand.workspaceId}/inbox`
        : `/dashboard/${brand.workspaceId}`))
    }
  }

  const accent = brand.accent ?? '#18181b'
  return (
    <main className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: '#f4f4f5', color: '#18181b' }}>
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-6">
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brand.logoUrl} alt={brand.name} className="h-12 max-w-[220px] object-contain mb-4" />
          ) : (
            <div className="h-12 w-12 rounded-xl mb-4 flex items-center justify-center text-white text-xl font-bold" style={{ background: accent }}>
              {brand.name.slice(0, 1).toUpperCase()}
            </div>
          )}
          <h1 className="text-xl font-semibold" style={{ color: '#18181b' }}>
            {brand.heading || `Sign in to ${brand.name}`}
          </h1>
          {brand.message && (
            <p className="mt-2 text-sm whitespace-pre-line" style={{ color: '#52525b' }}>{brand.message}</p>
          )}
        </div>
        <div className="rounded-2xl p-6 shadow-sm" style={{ background: '#ffffff', border: '1px solid #e4e4e7' }}>
          {sp.error === 'no_access' && (
            <p className="mb-4 text-sm rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: '#b91c1c' }}>
              Your account isn&rsquo;t on this team. Sign in with a different email, or ask your administrator for an invite.
            </p>
          )}
          <SignInForm accent={accent} callbackUrl={callbackUrl} initialEmail={typeof sp.email === 'string' ? sp.email : ''} />
        </div>
      </div>
    </main>
  )
}
