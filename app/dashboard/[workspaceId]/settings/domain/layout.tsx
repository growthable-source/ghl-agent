import { notFound } from 'next/navigation'
import { whitelabelManager } from '@/lib/whitelabel/manager'

/**
 * The Custom domain page is white-label: workspace owner / platform admin
 * only (lib/whitelabel/manage-policy.ts). Everyone else gets a plain 404 —
 * admins must not learn the page exists. The page itself is a client
 * component, so the guard lives here; the API refuses them too.
 */
export default async function CustomDomainLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  if (!(await whitelabelManager(workspaceId))) notFound()
  return children
}
