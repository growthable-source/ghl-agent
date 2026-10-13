import SettingsShell from '@/components/dashboard/SettingsShell'

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
  return <SettingsShell workspaceId={workspaceId}>{children}</SettingsShell>
}
