/**
 * Curated registry of well-known MCP servers.
 *
 * Each entry hydrates the "Connect MCP" form with sensible defaults so the
 * user only has to paste an auth token. Custom URL still works as an
 * escape hatch — see /dashboard/[workspaceId]/integrations.
 *
 * Add an entry by:
 *   1. Pushing onto MCP_REGISTRY below
 *   2. Verifying the server speaks JSON-RPC over HTTP and exposes
 *      `tools/list` (the discovery call we make)
 */

export interface RegistryEntry {
  slug: string
  name: string
  description: string
  iconUrl: string
  category: 'ads' | 'crm' | 'comms' | 'finance' | 'devops' | 'data' | 'other'
  defaultUrl: string
  authType: 'bearer' | 'header' | 'none'
  authHelp: string                      // shown under the secret input
  authHelpUrl?: string                  // link to where the user gets the token
  exampleRules?: Array<{ tool: string; whenToUse: string }>
}

export const MCP_REGISTRY: RegistryEntry[] = [
  {
    slug: 'meta-ads',
    name: 'Meta Ads',
    description: 'Read and manage Facebook + Instagram ad campaigns, ad sets, and creatives.',
    iconUrl: 'https://cdn.simpleicons.org/meta/0866FF',
    category: 'ads',
    defaultUrl: 'https://mcp.meta.com/ads/v1',
    authType: 'bearer',
    authHelp: 'Paste a Meta Marketing API access token with ads_read + ads_management scopes.',
    authHelpUrl: 'https://developers.facebook.com/docs/marketing-api/get-started',
    exampleRules: [
      { tool: 'pause_campaign', whenToUse: 'When the contact reports their ads are spending too fast or asks to pause a campaign by name.' },
      { tool: 'get_campaign_performance', whenToUse: 'When the contact asks about ROAS, CPM, CTR, spend, or conversion numbers for the last 7/30 days.' },
      { tool: 'suggest_optimizations', whenToUse: 'When performance is below target and the contact asks what to change.' },
    ],
  },
  {
    slug: 'stripe',
    name: 'Stripe',
    description: 'Look up customers, charges, subscriptions, and refunds.',
    iconUrl: 'https://cdn.simpleicons.org/stripe/635BFF',
    category: 'finance',
    defaultUrl: 'https://mcp.stripe.com/v1',
    authType: 'bearer',
    authHelp: 'Use a restricted Stripe API key (sk_live_… or rk_live_…). Read-only is safest unless you want refunds.',
    authHelpUrl: 'https://dashboard.stripe.com/apikeys',
    exampleRules: [
      { tool: 'find_customer', whenToUse: 'When the contact asks about their billing, subscription, or recent charges.' },
      { tool: 'issue_refund', whenToUse: 'Only when the contact explicitly requests a refund and provides a charge ID or invoice number.' },
    ],
  },
  {
    slug: 'linear',
    name: 'Linear',
    description: 'Create and update issues, search by status or assignee, post comments.',
    iconUrl: 'https://cdn.simpleicons.org/linear/5E6AD2',
    category: 'devops',
    defaultUrl: 'https://mcp.linear.app/v1',
    authType: 'bearer',
    authHelp: 'Generate a personal API key in Linear → Settings → API.',
    authHelpUrl: 'https://linear.app/settings/api',
    exampleRules: [
      { tool: 'create_issue', whenToUse: 'When the contact reports a bug or feature request that should turn into an engineering ticket.' },
      { tool: 'find_issue', whenToUse: 'When the contact references a ticket number or wants status on something they reported.' },
    ],
  },
]

export function findRegistryEntry(slug: string | null | undefined): RegistryEntry | null {
  if (!slug) return null
  return MCP_REGISTRY.find(r => r.slug === slug) || null
}
