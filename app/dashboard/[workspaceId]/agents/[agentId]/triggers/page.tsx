import { redirect } from 'next/navigation'

/**
 * Legacy redirect — Proactive triggers UI moved inline into the unified
 * "When this agent runs" editor at /trigger (singular). Old deep links
 * land here and bounce forward.
 */
export default async function ProactiveTriggersLegacyRedirect({
  params,
}: {
  params: Promise<{ workspaceId: string; agentId: string }>
}) {
  const { workspaceId, agentId } = await params
  redirect(`/dashboard/${workspaceId}/agents/${agentId}/trigger`)
}
