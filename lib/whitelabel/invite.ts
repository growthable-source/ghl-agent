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
import { createPreviewToken, previewLinkPath } from './preview'

/**
 * `requestOrigin` is the origin the inviter is using. On a non-production
 * build, an unlocked workspace with no live domain gets a white-label
 * TEST link on that origin instead (lib/whitelabel/preview.ts), so
 * testers can be invited without any domain set up.
 */
export async function inviteTarget(workspaceId: string, email: string, token: string, requestOrigin: string): Promise<{
  inviteUrl: string
  brand: TeamBrand | null
}> {
  const appBase = process.env.NEXT_PUBLIC_APP_URL || ''
  const origin = await getWorkspacePublicOrigin(workspaceId, '')
  const brand = await teamBrandForWorkspace(workspaceId)
  if (origin && brand) {
    return { inviteUrl: `${origin}/sign-in?email=${encodeURIComponent(email)}`, brand }
  }
  const previewToken = brand ? createPreviewToken(workspaceId) : null
  if (brand && previewToken) {
    return { inviteUrl: `${requestOrigin}${previewLinkPath(previewToken, email)}`, brand }
  }
  return { inviteUrl: `${appBase}/invite/${token}`, brand: null }
}
