import Link from 'next/link'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { requireAdminOrNull } from '@/lib/admin-auth'
import NewPortalForm from './NewPortalForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'New portal · Xovera Admin',
  robots: { index: false, follow: false },
}

export default async function NewPortalPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  // All brands across workspaces — a portal isn't tied to the admin's
  // own workspace, so the picker offers every brand on the platform.
  const allBrands = await db.brand.findMany({
    orderBy: [{ workspace: { name: 'asc' } }, { name: 'asc' }],
    select: { id: true, name: true, slug: true, workspace: { select: { id: true, name: true } } },
  })

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/portals" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Portals
        </Link>
        <h1 className="text-2xl font-semibold text-white mt-2">New portal</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Name the portal and pick the brands it exposes — from any workspace. You can change the brands
          and invite customers afterwards.
        </p>
      </div>
      <NewPortalForm allBrands={allBrands} />
    </div>
  )
}
