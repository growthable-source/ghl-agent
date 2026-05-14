'use client'

import { useParams } from 'next/navigation'
import InboxConversationPanel from '@/components/inbox/InboxConversationPanel'

/**
 * Standalone conversation detail route — used for deep-links from
 * notifications and shared URLs. The router picks widget vs Meta
 * based on the id prefix; both share this entry point.
 *
 * The `flex-1 flex h-full` wrapper is load-bearing: the inner
 * ConversationDetail uses flex-1 chains throughout to size its message
 * list + composer so the composer stays glued to the viewport bottom
 * and only the message list scrolls. Without an explicit height parent
 * here, those flex-1s had nothing to size against and the whole page
 * grew past the viewport — operators had to scroll all the way to the
 * bottom to find the composer, exactly the QA bug filed.
 */
export default function InboxDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const conversationId = decodeURIComponent(params.conversationId as string)
  return (
    <div className="flex-1 flex h-full overflow-hidden">
      <InboxConversationPanel workspaceId={workspaceId} conversationId={conversationId} />
    </div>
  )
}
