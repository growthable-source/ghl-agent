import { redirect } from 'next/navigation'

/**
 * Legacy redirect — channel deployment UI moved inline into the unified
 * "When this agent runs" editor at /trigger. Old deep links land here
 * and bounce forward.
 */
export default async function DeployLegacyRedirect({
  params,
}: {
  params: Promise<{ workspaceId: string; agentId: string }>
}) {
  const { workspaceId, agentId } = await params
  redirect(`/dashboard/${workspaceId}/agents/${agentId}/trigger`)
}
