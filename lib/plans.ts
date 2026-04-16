/**
 * Plan configuration and feature gating for Voxility.
 *
 * Tiers: trial → starter → growth → scale
 * Trial gives full Growth-tier access for 7 days.
 */

export type PlanId = 'trial' | 'starter' | 'growth' | 'scale'

export interface PlanFeatures {
  label: string
  monthlyPrice: number        // USD — 0 for trial
  annualPrice: number         // per month, billed annually
  agents: number              // included agent slots
  messagesPerMonth: number    // included AI messages
  voiceMinutes: number        // included voice minutes (0 = not available)
  workspaces: number          // max workspaces per account
  teamMembers: number         // max members per workspace (Infinity = unlimited)
  knowledgeEntries: number    // per agent
  channels: string[]          // available channels
  tools: string[]             // available tool slugs
  crossDomainInvites: boolean // can invite users from different email domains
  voiceEnabled: boolean
  leadScoring: boolean
  sentimentDetection: boolean
  followUpSequences: boolean
  triggers: boolean
  customPersona: boolean
  extraAgentPrice: number     // USD per additional agent per month
  messageOveragePrice: number // USD per message above limit
  voiceOveragePrice: number   // USD per minute above limit
}

// ─── Stripe Price IDs — set these after creating products in Stripe ─────────
export const STRIPE_PRICES = {
  starter: {
    monthly: process.env.STRIPE_PRICE_STARTER_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_STARTER_ANNUAL || '',
  },
  growth: {
    monthly: process.env.STRIPE_PRICE_GROWTH_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_GROWTH_ANNUAL || '',
  },
  scale: {
    monthly: process.env.STRIPE_PRICE_SCALE_MONTHLY || '',
    annual: process.env.STRIPE_PRICE_SCALE_ANNUAL || '',
  },
  // Metered prices for overage billing
  messageOverage: process.env.STRIPE_PRICE_MESSAGE_OVERAGE || '',
  voiceOverage: process.env.STRIPE_PRICE_VOICE_OVERAGE || '',
  // Quantity-based price for extra agents
  extraAgent: process.env.STRIPE_PRICE_EXTRA_AGENT || '',
} as const

// ─── All supported channels ─────────────────────────────────────────────────
const ALL_CHANNELS = ['SMS', 'WhatsApp', 'GMB', 'FB', 'IG', 'Live_Chat', 'Email']
const BASIC_CHANNELS = ['SMS', 'Email', 'Live_Chat']

// ─── All tools ──────────────────────────────────────────────────────────────
const CORE_TOOLS = [
  'get_contact_details',
  'send_reply',
  'send_sms',
  'update_contact_tags',
  'get_opportunities',
  'move_opportunity_stage',
  'add_contact_note',
]

const ADVANCED_TOOLS = [
  ...CORE_TOOLS,
  'get_available_slots',
  'book_appointment',
  'send_email',
  'create_opportunity',
  'update_contact_custom_fields',
  'schedule_followup',
  'score_lead',
  'detect_sentiment',
]

const ALL_TOOLS = [
  ...ADVANCED_TOOLS,
  'transfer_call',
  'end_call',
]

// ─── Plan definitions ───────────────────────────────────────────────────────

export const PLAN_FEATURES: Record<PlanId, PlanFeatures> = {
  trial: {
    label: 'Trial',
    monthlyPrice: 0,
    annualPrice: 0,
    agents: 3,
    messagesPerMonth: 1500,
    voiceMinutes: 30,
    workspaces: 1,
    teamMembers: 3,
    knowledgeEntries: 50,
    channels: ALL_CHANNELS,
    tools: ALL_TOOLS,
    crossDomainInvites: true,
    voiceEnabled: true,
    leadScoring: true,
    sentimentDetection: true,
    followUpSequences: true,
    triggers: true,
    customPersona: true,
    extraAgentPrice: 0,
    messageOveragePrice: 0,
    voiceOveragePrice: 0,
  },

  starter: {
    label: 'Starter',
    monthlyPrice: 297,
    annualPrice: 247,
    agents: 3,
    messagesPerMonth: 1500,
    voiceMinutes: 0,
    workspaces: 1,
    teamMembers: 2,
    knowledgeEntries: 25,
    channels: BASIC_CHANNELS,
    tools: CORE_TOOLS,
    crossDomainInvites: false,
    voiceEnabled: false,
    leadScoring: false,
    sentimentDetection: false,
    followUpSequences: true,
    triggers: true,
    customPersona: false,
    extraAgentPrice: 49,
    messageOveragePrice: 0.04,
    voiceOveragePrice: 0,
  },

  growth: {
    label: 'Growth',
    monthlyPrice: 497,
    annualPrice: 414,
    agents: 5,
    messagesPerMonth: 5000,
    voiceMinutes: 60,
    workspaces: 3,
    teamMembers: 5,
    knowledgeEntries: 50,
    channels: ALL_CHANNELS,
    tools: ADVANCED_TOOLS,
    crossDomainInvites: true,
    voiceEnabled: true,
    leadScoring: true,
    sentimentDetection: true,
    followUpSequences: true,
    triggers: true,
    customPersona: true,
    extraAgentPrice: 39,
    messageOveragePrice: 0.04,
    voiceOveragePrice: 0.18,
  },

  scale: {
    label: 'Scale',
    monthlyPrice: 997,
    annualPrice: 831,
    agents: 15,
    messagesPerMonth: 15000,
    voiceMinutes: 200,
    workspaces: 10,
    teamMembers: Infinity,
    knowledgeEntries: 100,
    channels: ALL_CHANNELS,
    tools: ALL_TOOLS,
    crossDomainInvites: true,
    voiceEnabled: true,
    leadScoring: true,
    sentimentDetection: true,
    followUpSequences: true,
    triggers: true,
    customPersona: true,
    extraAgentPrice: 29,
    messageOveragePrice: 0.04,
    voiceOveragePrice: 0.18,
  },
}

// ─── Feature-gating helpers ─────────────────────────────────────────────────

/** Get the effective plan features. Trial uses Growth-tier features. */
export function getPlanFeatures(plan: string): PlanFeatures {
  const id = (plan || 'trial') as PlanId
  return PLAN_FEATURES[id] || PLAN_FEATURES.trial
}

/** Check if the workspace can create another agent */
export function canCreateAgent(plan: string, currentAgentCount: number, extraAgentCount: number): boolean {
  const features = getPlanFeatures(plan)
  return currentAgentCount < features.agents + extraAgentCount
}

/** Check if a message can be sent (soft limit — always returns true but flags overage) */
export function checkMessageUsage(plan: string, currentUsage: number, limit: number): {
  allowed: boolean
  isOverage: boolean
  overage: number
} {
  // Messages are soft-limited: we always allow but track overage
  const isOverage = currentUsage >= limit
  return {
    allowed: true,
    isOverage,
    overage: isOverage ? currentUsage - limit + 1 : 0,
  }
}

/** Check if voice is available on this plan */
export function canUseVoice(plan: string): boolean {
  return getPlanFeatures(plan).voiceEnabled
}

/** Check if a specific tool is available on this plan */
export function canUseTool(plan: string, toolSlug: string): boolean {
  return getPlanFeatures(plan).tools.includes(toolSlug)
}

/** Check if a channel is available on this plan */
export function canUseChannel(plan: string, channel: string): boolean {
  return getPlanFeatures(plan).channels.includes(channel)
}

/** Check if cross-domain invites are allowed */
export function canInviteCrossDomain(plan: string): boolean {
  return getPlanFeatures(plan).crossDomainInvites
}

/** Check if the user can create another workspace */
export function canCreateWorkspace(plan: string, currentWorkspaceCount: number): boolean {
  return currentWorkspaceCount < getPlanFeatures(plan).workspaces
}

/** Check if the team can add more members */
export function canAddTeamMember(plan: string, currentMemberCount: number): boolean {
  const max = getPlanFeatures(plan).teamMembers
  return currentMemberCount < max
}

/** Check if a feature flag is enabled */
export function canUseFeature(plan: string, feature: keyof PlanFeatures): boolean {
  const val = getPlanFeatures(plan)[feature]
  if (typeof val === 'boolean') return val
  if (typeof val === 'number') return val > 0
  return true
}

/** Check if trial has expired */
export function isTrialExpired(trialEndsAt: Date | null): boolean {
  if (!trialEndsAt) return false
  return new Date() > trialEndsAt
}

/** Get billing period string for the current month (e.g. "2026-04") */
export function currentBillingPeriod(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** Default limits when a workspace selects a plan */
export function getPlanDefaults(plan: PlanId): {
  agentLimit: number
  messageLimit: number
  voiceMinuteLimit: number
} {
  const features = PLAN_FEATURES[plan] || PLAN_FEATURES.trial
  return {
    agentLimit: features.agents,
    messageLimit: features.messagesPerMonth,
    voiceMinuteLimit: features.voiceMinutes,
  }
}
