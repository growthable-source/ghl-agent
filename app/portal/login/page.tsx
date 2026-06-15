import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPortalSession } from '@/lib/portal-auth'
import { getPortalBranding } from '@/lib/portal-branding'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalLoginPage() {
  const session = await getPortalSession()
  if (session) redirect('/portal')

  // On a whitelabel custom domain, brand the login with that portal.
  const branding = await getPortalBranding((await headers()).get('host'))
  const accent = branding?.primaryColor?.trim() || null

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {branding?.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={branding.logoUrl} alt={branding.name} className="h-9 mx-auto mb-3" />
          ) : (
            <p
              className="text-[10px] font-semibold uppercase tracking-widest"
              style={accent ? { color: accent } : undefined}
            >
              {branding?.name ?? 'Voxility'}
            </p>
          )}
          <h1 className="text-2xl font-semibold text-white mt-2">
            {branding ? branding.name : 'Customer Portal'}
          </h1>
          <p className="text-sm text-zinc-400 mt-2">
            Sign in to view conversations and CSAT for your brands.
          </p>
        </div>
        <LoginForm accent={accent} />
      </div>
    </div>
  )
}
