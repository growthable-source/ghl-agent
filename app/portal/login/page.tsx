import { redirect } from 'next/navigation'
import { getPortalSession } from '@/lib/portal-auth'
import LoginForm from './LoginForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sign in · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalLoginPage() {
  const session = await getPortalSession()
  if (session) redirect('/portal')

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-amber-400/90">
            Voxility
          </p>
          <h1 className="text-2xl font-semibold text-white mt-2">Customer Portal</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Sign in to view conversations and CSAT for your brands.
          </p>
        </div>
        <LoginForm />
      </div>
    </div>
  )
}
