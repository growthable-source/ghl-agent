import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireAdminOrNull } from '@/lib/admin-auth'
import NewPortalForm from './NewPortalForm'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'New portal · Voxility Admin',
  robots: { index: false, follow: false },
}

export default async function NewPortalPage() {
  const session = await requireAdminOrNull()
  if (!session) redirect('/admin/login')

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <Link href="/admin/portals" className="text-zinc-500 hover:text-zinc-300 text-sm">
          ← Portals
        </Link>
        <h1 className="text-2xl font-semibold text-white mt-2">New portal</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Name the portal, then add the brands it exposes and invite customers. A portal can serve brands
          from any workspace.
        </p>
      </div>
      <NewPortalForm />
    </div>
  )
}
