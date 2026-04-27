/**
 * Data-driven comparison pages.
 *
 * Each entry renders as /compare/<slug>. Keep the tone honest — these
 * are the kind of pages competitors and customers both scrutinise, and
 * lying on them tanks trust faster than missing features.
 *
 * Structure per comparison:
 *   - Header metadata (title, description — used for SEO + OG)
 *   - Them: what the other tool calls itself, one-paragraph pitch
 *   - Rows: a feature matrix, 8–12 items. Each row has an honest
 *     "us" and "them" cell; use `kind` to drive a ✓ / ✗ / ~ badge.
 *   - Verdict sections: when to pick us, when to pick them. Real
 *     scenarios, not marketing spin.
 */

export type CompareCellKind = 'yes' | 'no' | 'partial' | 'na'

export interface CompareRow {
  feature: string
  us: { kind: CompareCellKind; note?: string }
  them: { kind: CompareCellKind; note?: string }
}

export interface Comparison {
  slug: string
  us: string                 // usually "Voxility"
  them: string               // competitor name
  title: string              // page title
  description: string        // meta desc + OG
  /** Short paragraph on what THEY position as — their elevator pitch. */
  theirPitch: string
  /** Short paragraph on what WE position as — how we differ deliberately. */
  ourAngle: string
  /** Feature matrix. */
  rows: CompareRow[]
  /** When the reader should pick THEM, honestly. */
  whenToPickThem: string[]
  /** When the reader should pick US. */
  whenToPickUs: string[]
  /** ISO date — used for freshness signal on the page + sitemap. */
  updatedAt: string
}

export const COMPARISONS: Comparison[] = [
  {
    slug: 'voxility-vs-synthflow',
    us: 'Voxility',
    them: 'Synthflow',
    title: 'Voxility vs. Synthflow — honest comparison for GoHighLevel',
    description: 'Voxility vs. Synthflow: both run AI agents that take calls. We dig into where each one wins — voice quality, CRM integration depth, multi-channel support, and the feedback loop — so you can pick without a weeklong trial.',
    theirPitch: 'Synthflow is a voice-first AI agent platform that\'s built a solid reputation for call quality and reliability. It integrates with GoHighLevel via webhooks and custom triggers, and the builder is genuinely easy to use for inbound call flows (qualify → book → transfer).',
    ourAngle: 'Voxility is built as a first-class GoHighLevel marketplace app — the agent reads and writes CRM data natively, and covers every channel (voice, SMS, email, WhatsApp, Instagram, Facebook, Google Business, live chat) with one brain. Where Synthflow is a voice-only tool that bolts onto GHL, we live inside it.',
    rows: [
      { feature: 'Inbound + outbound voice calls', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'SMS, email, WhatsApp, Instagram, Facebook, GMB, live chat', us: { kind: 'yes' }, them: { kind: 'no', note: 'Voice-only' } },
      { feature: 'GoHighLevel marketplace install', us: { kind: 'yes' }, them: { kind: 'partial', note: 'Webhooks + custom triggers' } },
      { feature: 'Native CRM tool calls (tag, move stage, enroll in workflow, etc.)', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial', note: 'Via GHL workflows' } },
      { feature: '100+ ElevenLabs voice options', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Real-time calendar availability + booking', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Auto-reviewed conversations → prompt improvements', us: { kind: 'yes', note: '~30s to apply' }, them: { kind: 'no' } },
      { feature: 'Multi-persona simulation swarm', us: { kind: 'yes', note: '7 personas' }, them: { kind: 'no' } },
      { feature: 'Inline playground thumbs-up/down feedback', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'HubSpot integration', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Human-approval queue before outbound sends', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Free tier', us: { kind: 'yes', note: 'Free while in beta' }, them: { kind: 'no' } },
    ],
    whenToPickThem: [
      'You only need voice, no messaging.',
      'Your use case is pure inbound call deflection and the CRM writes are minimal.',
      'You want a mature, stable voice product and don\'t care about self-improvement.',
    ],
    whenToPickUs: [
      'You live inside GoHighLevel and want the AI to actually do things there — not relay via a webhook.',
      'You need multi-channel coverage (voice + SMS + email + social DMs) from one agent.',
      'You want agents that measurably improve over time from real conversations, not a frozen prompt.',
      'You\'re on HubSpot as well as, or instead of, GHL.',
    ],
    updatedAt: '2026-04-24',
  },

  {
    slug: 'voxility-vs-gohighlevel-conversation-ai',
    us: 'Voxility',
    them: 'GoHighLevel Conversation AI',
    title: 'Voxility vs. GoHighLevel\u2019s built-in Conversation AI',
    description: 'GoHighLevel Conversation AI is free and built-in. Voxility is an add-on. Here\u2019s honestly where each wins — and when the free built-in option is genuinely the right call.',
    theirPitch: 'GoHighLevel ships a built-in Conversation AI that auto-replies to inbox messages (SMS + chat), handles basic qualifying, and does it all at no extra cost. For an agency just getting started, the zero-friction price tag is meaningful.',
    ourAngle: 'Voxility is an installable marketplace app that runs alongside — not against — the built-in assistant. The built-in tool is great for &ldquo;someone is texting us, send a canned-ish reply.&rdquo; Voxility is for &ldquo;the AI should actually qualify, book, and update the CRM, across every channel, and get measurably better over time.&rdquo;',
    rows: [
      { feature: 'Free', us: { kind: 'partial', note: 'Free in beta' }, them: { kind: 'yes' } },
      { feature: 'Inbound + outbound voice calls', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'SMS auto-reply', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Email, WhatsApp, Instagram, Facebook, GMB, live chat', us: { kind: 'yes' }, them: { kind: 'partial', note: 'Inbox-limited' } },
      { feature: 'Native tool use (book, tag, move stage, enroll)', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial', note: 'Handoff to workflows' } },
      { feature: 'Per-agent persona, qualifying Qs, business context', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Knowledge base with crawling + chunking', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Simulation + auto-reviewed learnings', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Inline feedback → prompt improvement', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Human-approval queue', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Available for HubSpot', us: { kind: 'yes' }, them: { kind: 'na' } },
    ],
    whenToPickThem: [
      'You only need basic inbound SMS auto-replies and you\u2019re happy with canned-ish responses.',
      'Budget is zero and you\u2019re not running on voice.',
      'You want to stay inside the HighLevel product family with zero third-party installs.',
    ],
    whenToPickUs: [
      'You need voice calls, not just SMS.',
      'You want the agent to take real CRM actions (book, tag, move, enroll) natively.',
      'You have customer-facing channels beyond SMS — Instagram DMs, WhatsApp, GMB chat, live chat.',
      'You want agents that get smarter over time rather than serving the same canned reply for 18 months.',
    ],
    updatedAt: '2026-04-24',
  },
]

export function findComparisonBySlug(slug: string): Comparison | undefined {
  return COMPARISONS.find(c => c.slug === slug)
}
