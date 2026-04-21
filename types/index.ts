// ─── OAuth ─────────────────────────────────────────────────────────────────

export interface OAuthTokenResponse {
  access_token: string
  refresh_token: string
  refreshTokenId: string
  expires_in: number
  token_type: string
  scope: string
  userType: 'Location' | 'Company'
  locationId?: string
  companyId: string
  userId: string
  planId?: string
}

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  refreshTokenId: string
  userType: 'Location' | 'Company'
  companyId: string
  locationId?: string
  userId: string
  scope: string
  expiresAt: number
  installedAt: number
}

// ─── CRM Entities ──────────────────────────────────────────────────────────

export interface Contact {
  id: string
  locationId: string
  firstName?: string
  lastName?: string
  name?: string
  email?: string
  phone?: string
  tags?: string[]
  source?: string
  customFields?: Array<{ id: string; value: string }>
  dateAdded?: string
  dateUpdated?: string
  /**
   * GHL user ID of the team member the contact is assigned to. Powers
   * {{user.name}} / {{user.email}} / {{user.phone}} merge fields — the
   * renderer resolves this into a full user record on demand.
   */
  assignedTo?: string
}

/**
 * CRM user / team member record. Exposed to merge-field rendering so
 * messages can reference the owner of the assigned contact.
 */
export interface CrmUser {
  id: string
  name?: string
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  extension?: string
}

export interface Conversation {
  id: string
  locationId: string
  contactId: string
  lastMessageType?: string
  lastMessageDate?: string
  unreadCount?: number
  type?: string
  inbox?: boolean
}

export interface Message {
  id: string
  conversationId: string
  locationId: string
  contactId?: string
  body: string
  direction: 'inbound' | 'outbound'
  status?: string
  messageType?: string
  dateAdded?: string
  contentType?: string
}

export interface Opportunity {
  id: string
  name: string
  locationId: string
  contactId?: string
  pipelineId: string
  pipelineStageId: string
  status: string
  monetaryValue?: number
  assignedTo?: string
  createdAt?: string
  updatedAt?: string
}

export type MessageChannelType = 'SMS' | 'Email' | 'WhatsApp' | 'GMB' | 'FB' | 'IG' | 'Live_Chat' | 'Custom'

/** Channels supported for agent deployment and inbound message handling */
export const SUPPORTED_CHANNELS: MessageChannelType[] = ['SMS', 'WhatsApp', 'GMB', 'FB', 'IG', 'Live_Chat', 'Email']

export interface SendMessagePayload {
  type: MessageChannelType
  contactId: string
  conversationProviderId?: string
  message: string
  subject?: string
  html?: string
}

// ─── Agent ─────────────────────────────────────────────────────────────────

export interface AgentContext {
  locationId: string
  contactId: string
  conversationId?: string
  contact?: Contact
}

// ─── Webhooks ──────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'INSTALL'
  | 'InboundMessage'
  | 'OutboundMessage'
  | 'ContactCreate'
  | 'ContactTagUpdate'
  | 'OpportunityStageUpdate'
  | 'OpportunityStatusUpdate'
  | string

export interface WebhookInstallPayload {
  type: 'INSTALL'
  appId: string
  companyId: string
  locationId: string
  companyName?: string
  userId?: string
}

export interface WebhookMessagePayload {
  type: 'InboundMessage' | 'OutboundMessage'
  locationId: string
  contactId: string
  conversationId: string
  conversationProviderId?: string
  messageId: string
  body: string
  messageType: MessageChannelType | string
  direction: 'inbound' | 'outbound'
  dateAdded?: string
}

export interface WebhookContactCreatePayload {
  type: 'ContactCreate'
  locationId: string
  id: string               // this is the contactId
  contactId?: string       // some events may use this instead
  firstName?: string
  lastName?: string
  email?: string
  phone?: string
  tags?: string[]
}

export interface WebhookContactTagUpdatePayload {
  type: 'ContactTagUpdate'
  locationId: string
  contactId: string
  tags: string[]
}
