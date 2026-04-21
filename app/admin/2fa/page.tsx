import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { getAdminSession } from '@/lib/admin-auth'
import TwoFactorClient from './TwoFactorClient'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage() {
  const session = await getAdminSession()
  if (!session) redirect('/admin/login')
  // Setup is reachable even without 2FA verified — it's the only way to
  // complete a pending enrolment.

  const admin = await db.superAdmin.findUnique({
    where: { id: session.adminId },
    select: { twoFactorVerifiedAt: true },
  })
  const enrolled = !!admin?.twoFactorVerifiedAt

  return (
    <div className="p-8 max-w-xl">
      <h1 className="text-xl font-semibold">Two-factor authentication</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-6">
        TOTP codes from your authenticator app (1Password, Authy, Google Authenticator, Bitwarden…).
      </p>
      <TwoFactorClient initiallyEnrolled={enrolled} />
    </div>
  )
}
