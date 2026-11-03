import SettingsShell from '@/components/dashboard/SettingsShell'
import { whitelabelManager } from '@/lib/whitelabel/manager'

/**
 * Settings shell layout — wraps every /dashboard/<ws>/settings/* page with
 * the grouped settings nav (UI redesign handoff §2). Access control is
 * already enforced by the parent workspace layout.
 */
export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  const canManageWhitelabel = !!(await whitelabelManager(workspaceId))
  return <SettingsShell workspaceId={workspaceId} canManageWhitelabel={canManageWhitelabel}>{children}</SettingsShell>
}
