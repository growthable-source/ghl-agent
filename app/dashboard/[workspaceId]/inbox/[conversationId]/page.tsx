'use client'

import { useParams } from 'next/navigation'
import InboxConversationPanel from '@/components/inbox/InboxConversationPanel'

/**
 * Standalone conversation detail route — used for deep-links from
 * notifications and shared URLs. The router picks widget vs Meta
 * based on the id prefix; both share this entry point.
 */
export default function InboxDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const conversationId = decodeURIComponent(params.conversationId as string)
  return <InboxConversationPanel workspaceId={workspaceId} conversationId={conversationId} />
}
