import { redirect } from 'next/navigation'
import { getPortalSession } from '@/lib/portal-auth'
import PortalApprovalsClient from '@/components/portal/PortalApprovalsClient'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Approvals · Customer Portal',
  robots: { index: false, follow: false },
}

export default async function PortalApprovals() {
  const session = await getPortalSession()
  if (!session) redirect('/portal/login')

  return (
    <div className="p-6 sm:p-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-semibold text-white">Approvals</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Ticket replies the support team wants to send to your customers. Nothing goes out until someone here signs it off.
        </p>
      </div>
      <PortalApprovalsClient />
    </div>
  )
}
