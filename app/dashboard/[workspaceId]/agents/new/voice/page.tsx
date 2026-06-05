/**
 * Back-compat redirect.
 *
 * The voice agent wizard moved from /agents/new/voice to /voice/new on
 * 2026-06-06 when voice agents got their own top-level dashboard
 * section. Existing bookmarks, the old sidebar/dropdown link, and the
 * occasional Slack message keep landing here — server-side redirect
 * forwards them to the canonical URL.
 */

import { redirect } from 'next/navigation'

export default async function VoiceWizardRedirect({
  params,
}: {
  params: Promise<{ workspaceId: string }>
}) {
  const { workspaceId } = await params
  redirect(`/dashboard/${workspaceId}/voice/new`)
}
