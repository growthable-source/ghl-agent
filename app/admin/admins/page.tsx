import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminRole } from '@/lib/admin-auth'
import AdminsClient from './AdminsClient'

export const dynamic = 'force-dynamic'

export default async function AdminsPage() {
  const session = await requireAdminRole('super')
  if (!session) redirect('/admin')

  const admins = await db.superAdmin.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, email: true, name: true, role: true, isActive: true,
      lastLoginAt: true, createdAt: true, twoFactorVerifiedAt: true,
    },
  })

  return (
    <div className="p-8 max-w-4xl">
      <h1 className="text-xl font-semibold">Admins</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-6">
        Manage super-admin accounts. Only super-role admins see this page.
      </p>
      <AdminsClient initial={admins.map(a => ({
        ...a,
        lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        twoFactorVerifiedAt: a.twoFactorVerifiedAt?.toISOString() ?? null,
      }))} currentAdminId={session.adminId} />
    </div>
  )
}
