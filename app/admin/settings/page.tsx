import { redirect } from 'next/navigation'
import { requireAdminRole } from '@/lib/admin-auth'
import { getAuditRetentionDays } from '@/lib/system-settings'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const session = await requireAdminRole('super')
  if (!session) redirect('/admin')

  const auditRetentionDays = await getAuditRetentionDays()

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-xl font-semibold">System settings</h1>
      <p className="text-sm text-zinc-500 mt-1 mb-6">
        Cross-workspace configuration. Super-only.
      </p>
      <SettingsClient initialAuditRetentionDays={auditRetentionDays} />
    </div>
  )
}
