'use client'

import { useParams } from 'next/navigation'
import InboxConversationPanel from '@/components/inbox/InboxConversationPanel'

/**
 * Standalone conversation detail route — used for deep-links from
 * notifications and shared URLs. The router picks widget vs Meta
 * based on the id prefix; both share this entry point.
 *
 * The `flex-1 min-h-0 flex overflow-hidden` wrapper is load-bearing:
 * the workspace layout passes the bounded viewport height down as a
 * flex column; flex-1 fills it and min-h-0 + overflow-hidden let this
 * box shrink to fit, so ConversationDetail's message list scrolls
 * internally and the composer stays glued to the viewport bottom.
 */
export default function InboxDetailPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const conversationId = decodeURIComponent(params.conversationId as string)
  return (
    <div className="flex-1 min-h-0 flex overflow-hidden">
      <InboxConversationPanel workspaceId={workspaceId} conversationId={conversationId} />
    </div>
  )
}
