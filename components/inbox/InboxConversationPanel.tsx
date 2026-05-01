'use client'

/**
 * Thin router that picks the right detail component based on the
 * conversation id prefix:
 *
 *   `meta:<cuid>` → Messenger / Instagram thread (MetaConversationDetail)
 *   bare cuid     → website widget thread (ConversationDetail)
 *
 * Lives outside ConversationDetail so we don't violate React's rules
 * of hooks (the widget detail panel relies on a long list of hooks
 * declared at the top — we can't early-return above them).
 */

import ConversationDetail from './ConversationDetail'
import MetaConversationDetail from './MetaConversationDetail'

interface Props {
  workspaceId: string
  conversationId: string
  onClose?: () => void
}

export default function InboxConversationPanel({ workspaceId, conversationId, onClose }: Props) {
  if (conversationId.startsWith('meta:')) {
    return (
      <MetaConversationDetail
        workspaceId={workspaceId}
        conversationId={conversationId.slice('meta:'.length)}
        onClose={onClose}
      />
    )
  }
  return (
    <ConversationDetail
      workspaceId={workspaceId}
      conversationId={conversationId}
      onClose={onClose}
    />
  )
}
