/**
 * Where a workspace invite should send the invitee, and under whose brand.
 *
 * A white-label workspace with an active domain invites people to its
 * OWN branded sign-in page (https://<domain>/sign-in?email=…): the code
 * they receive there accepts the invite (lib/whitelabel/sign-in.ts), so
 * they never see our host or need a Google account. Everyone else keeps
 * the normal /invite/<token> flow on our host.
 */

import { getWorkspacePublicOrigin } from '@/lib/domains/workspace-domain'
import { teamBrandForWorkspace, type TeamBrand } from '@/lib/domains/host-brand'

export async function inviteTarget(workspaceId: string, email: string, token: string): Promise<{
  inviteUrl: string
  brand: TeamBrand | null
}> {
  const appBase = process.env.NEXT_PUBLIC_APP_URL || ''
  const origin = await getWorkspacePublicOrigin(workspaceId, '')
  const brand = origin ? await teamBrandForWorkspace(workspaceId) : null
  if (origin && brand) {
    return { inviteUrl: `${origin}/sign-in?email=${encodeURIComponent(email)}`, brand }
  }
  return { inviteUrl: `${appBase}/invite/${token}`, brand: null }
}
