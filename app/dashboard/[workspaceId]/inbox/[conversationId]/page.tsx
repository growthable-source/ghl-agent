'use client'

import { useParams } from 'next/navigation'
import ConversationDetail from '@/components/inbox/ConversationDetail'

/**
 * Standalone conversation detail route — used for deep-links from
 * notifications and shared URLs. The same component renders inside
 * the split-pane inbox at /inbox?conversation=<id>; the wrapper just
 * pulls the IDs from the route and lets the back-link in the panel
 * navigate back to the list.
 */
export default function InboxDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const conversationId = params.conversationId as string
  return <ConversationDetail workspaceId={workspaceId} conversationId={conversationId} />
}
