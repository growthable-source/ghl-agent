/**
 * Catalog of notification events the platform emits, with human-readable
 * labels for the per-user preferences UI. Keep this in sync with the
 * `event` strings passed into notify() at every call site.
 */

export interface NotificationEventDef {
  id: string
  label: string
  description: string
  defaultUserChannels: string[]   // channels enabled out of the box for new users
}

export const NOTIFICATION_EVENTS: NotificationEventDef[] = [
  {
    id: 'widget.new_conversation',
    label: 'New chat started',
    description: 'A visitor opened a new conversation through one of your widgets.',
    defaultUserChannels: ['email', 'web_push'],
  },
  {
    id: 'conversation.stale',
    label: 'Conversation gone quiet',
    description: 'A widget chat hasn\'t had activity in a while — might need a nudge.',
    defaultUserChannels: ['email'],
  },
  {
    id: 'needs_attention',
    label: 'Conversation needs attention',
    description: 'An agent paused itself for sentiment, keyword match, or a stop condition.',
    defaultUserChannels: ['email', 'web_push'],
  },
  {
    id: 'approval_pending',
    label: 'Message awaiting approval',
    description: 'An agent draft was flagged for human review.',
    defaultUserChannels: ['email'],
  },
  {
    id: 'human_handover',
    label: 'Handed off to a human',
    description: 'An agent escalated a conversation to a human teammate.',
    defaultUserChannels: ['email', 'web_push'],
  },
  {
    id: 'widget.conversation_assigned',
    label: 'Chat assigned to you',
    description: 'A widget chat was routed (or manually assigned) to you to handle.',
    defaultUserChannels: ['email', 'web_push'],
  },
  {
    id: 'agent_error',
    label: 'Agent error',
    description: 'An agent ran into a problem processing an inbound message.',
    defaultUserChannels: ['email'],
  },
  {
    id: 'pause_activated',
    label: 'Workspace paused',
    description: 'Someone hit the workspace-wide pause switch.',
    defaultUserChannels: [],
  },
  {
    id: 'pause_deactivated',
    label: 'Workspace resumed',
    description: 'The workspace-wide pause was lifted.',
    defaultUserChannels: [],
  },
]

export const SUPPORTED_USER_CHANNELS = ['email', 'web_push'] as const
export type UserNotificationChannel = typeof SUPPORTED_USER_CHANNELS[number]

export function defaultPreferenceFor(eventId: string): string[] {
  const def = NOTIFICATION_EVENTS.find(e => e.id === eventId)
  return def?.defaultUserChannels ?? []
}
