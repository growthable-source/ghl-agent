/**
 * "X alternative" SEO landing pages. Each renders at a clean keyword URL
 * (e.g. /intercom-alternative) via a thin route folder + the shared
 * AlternativePage template. Reuses the honest CompareRow shape from
 * compare-data.ts. Keep claims defensible — these pages are scrutinised by
 * the very competitors they name.
 */
import type { CompareRow } from './compare-data'

export interface Alternative {
  /** Route slug = the page URL, e.g. 'intercom-alternative'. */
  slug: string
  competitor: string
  /** Uppercase eyebrow, e.g. 'Intercom alternative'. */
  eyebrow: string
  /** Page <h1>. */
  heading: string
  metaTitle: string
  metaDescription: string
  /** Hero subhead, 1–2 sentences. */
  hook: string
  theirPitch: string
  ourAngle: string
  rows: CompareRow[]
  whenToPickThem: string[]
  whenToPickUs: string[]
  faqs: { q: string; a: string }[]
  updatedAt: string
}

export const ALTERNATIVES: Alternative[] = [
  {
    slug: 'intercom-alternative',
    competitor: 'Intercom',
    eyebrow: 'Intercom alternative',
    heading: 'The Intercom alternative built to take action, not just reply',
    metaTitle: 'The best Intercom alternative for sales & support teams (2026)',
    metaDescription:
      'Looking for an Intercom alternative? Voxility runs AI agents across chat, SMS, email, social, and voice — that book, qualify, and update your CRM natively, and get better every week. Free while in beta.',
    hook: 'Intercom is a great support inbox. Voxility is an AI agent that actually does the work — across every channel, plugged straight into your CRM, improving from every conversation.',
    theirPitch:
      'Intercom is the category-defining customer messaging suite: a polished shared inbox, help center, product tours, and its Fin AI agent for support deflection. It is excellent if your world is web/in-app support and you are happy in Intercom’s own ecosystem and seat-plus-resolution pricing.',
    ourAngle:
      'Voxility is built for sales-and-marketing teams who live in GoHighLevel or HubSpot. The agent doesn’t just answer — it qualifies, books appointments, tags contacts, moves pipeline stages, and runs on voice calls as well as chat. And every conversation is auto-reviewed into a concrete prompt improvement, so the agent is measurably sharper next week.',
    rows: [
      { feature: 'AI agent for live chat', us: { kind: 'yes' }, them: { kind: 'yes', note: 'Fin' } },
      { feature: 'Voice calls (inbound + outbound)', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'SMS, WhatsApp, Instagram, Facebook, Google Business', us: { kind: 'yes' }, them: { kind: 'partial', note: 'Some via add-ons' } },
      { feature: 'Native GoHighLevel + HubSpot actions (book, tag, move stage)', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial', note: 'Via integrations' } },
      { feature: 'Books appointments mid-conversation', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Self-improving from every conversation', us: { kind: 'yes', note: '~30s to apply' }, them: { kind: 'no' } },
      { feature: 'Pre-launch simulation against 7 personas', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Pricing model', us: { kind: 'yes', note: 'Flat, free in beta' }, them: { kind: 'partial', note: 'Seat + per-resolution' } },
    ],
    whenToPickThem: [
      'Your core need is web/in-app product support with a help center and product tours.',
      'You’re standardized on Intercom and your team lives in that inbox.',
      'You don’t need voice or outbound, and per-resolution pricing fits your volume.',
    ],
    whenToPickUs: [
      'You run on GoHighLevel or HubSpot and want the AI to take real CRM actions, not relay to a human.',
      'You need voice calls and social DMs, not just website chat.',
      'You want agents that improve automatically instead of a frozen prompt.',
      'You want predictable pricing without per-resolution surprises.',
    ],
    faqs: [
      { q: 'Is Voxility a true Intercom alternative?', a: 'For sales and lead-gen teams, yes. Voxility covers live chat plus voice, SMS, and social, and the agent takes CRM actions natively. If you specifically need Intercom’s help center and in-app product tours, Intercom remains stronger there — Voxility focuses on agents that qualify, book, and update your CRM.' },
      { q: 'How is pricing different from Intercom / Fin?', a: 'Intercom blends per-seat pricing with per-resolution charges on Fin. Voxility is a flat plan (and free during beta), so cost doesn’t spike with conversation volume.' },
      { q: 'Can I keep my existing CRM?', a: 'Yes — Voxility installs from the GoHighLevel Marketplace and integrates with HubSpot. The agent reads and writes your CRM directly.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'fin-alternative',
    competitor: 'Intercom Fin',
    eyebrow: 'Fin alternative',
    heading: 'A Fin alternative that works every channel — and your CRM',
    metaTitle: 'Intercom Fin alternative — AI agents without per-resolution pricing',
    metaDescription:
      'A Fin alternative for teams who want more than support deflection: Voxility AI agents take calls, texts, and chats, book and qualify in your CRM, and improve automatically. No per-resolution fees.',
    hook: 'Fin is a strong support-deflection bot priced per resolution. Voxility is a full agent — voice + chat + CRM actions — on a flat plan that doesn’t tax you per conversation.',
    theirPitch:
      'Fin is Intercom’s AI agent, known for resolving support questions from your help content with good accuracy. It’s a clean fit if you’re already on Intercom and your goal is deflecting inbound support tickets, and you’re comfortable paying per successful resolution.',
    ourAngle:
      'Voxility is for converting and serving leads, not just deflecting tickets. The agent qualifies, books, and updates GoHighLevel/HubSpot natively, runs on phone calls and social DMs, and is auto-tuned from real conversations. Pricing is flat, so a viral month doesn’t blow up the bill.',
    rows: [
      { feature: 'Answers from your knowledge base', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Voice calls', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Outbound + multi-channel (SMS, social)', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Takes CRM actions (book, tag, move stage, enroll)', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial' } },
      { feature: 'Qualifies + scores leads', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Self-improves from conversations', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Per-resolution fees', us: { kind: 'yes', note: 'None — flat plan' }, them: { kind: 'no', note: 'Charged per resolution' } },
      { feature: 'Free tier', us: { kind: 'yes', note: 'Free in beta' }, them: { kind: 'no' } },
    ],
    whenToPickThem: [
      'You only need help-desk deflection and already run Intercom.',
      'Your support content is mature and per-resolution economics work for you.',
      'Voice and outbound aren’t part of your plan.',
    ],
    whenToPickUs: [
      'You want the AI to convert leads — qualify, book, follow up — not just answer FAQs.',
      'You need phone calls and social channels alongside chat.',
      'You want flat pricing instead of paying per resolution.',
      'You want an agent that gets better on its own.',
    ],
    faqs: [
      { q: 'Does Voxility deflect support questions like Fin?', a: 'Yes — point it at your website, docs, and data sources and it answers grounded questions. It also goes further: booking, qualifying, and updating your CRM, plus voice and social channels.' },
      { q: 'How does pricing compare to Fin?', a: 'Fin charges per resolution. Voxility is a flat plan (free during beta), so cost is predictable regardless of conversation volume.' },
      { q: 'Can it run on the phone?', a: 'Yes. Voxility handles inbound and outbound voice calls with natural voices, which Fin does not.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'zendesk-ai-alternative',
    competitor: 'Zendesk AI',
    eyebrow: 'Zendesk AI alternative',
    heading: 'A Zendesk AI alternative for teams that sell, not just ticket',
    metaTitle: 'Zendesk AI alternative — AI agents that qualify, book & convert',
    metaDescription:
      'A Zendesk AI alternative built for sales and marketing: Voxility AI agents work voice, chat, SMS, and social, take native CRM actions in GoHighLevel and HubSpot, and improve every week.',
    hook: 'Zendesk AI is built for enterprise support queues. Voxility is built to win and serve leads — across channels, inside your CRM, getting smarter automatically.',
    theirPitch:
      'Zendesk is an enterprise-grade support platform, and its AI adds agent assist, bots, and ticket triage on top of a mature ticketing system. It shines for large support orgs with complex routing, SLAs, and reporting needs.',
    ourAngle:
      'Voxility isn’t a ticketing system — it’s an AI agent for sales-and-marketing motions. It qualifies and books, runs voice calls and social DMs, lives natively inside GoHighLevel/HubSpot, and auto-improves from real conversations rather than relying on a team of admins to tune flows.',
    rows: [
      { feature: 'AI chat + agent assist', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Voice calls (AI, not just routing)', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'SMS, WhatsApp, Instagram, Facebook, GMB', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Native GoHighLevel + HubSpot actions', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial' } },
      { feature: 'Books appointments + qualifies leads', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Self-improving prompts', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Setup time', us: { kind: 'yes', note: 'Minutes' }, them: { kind: 'no', note: 'Implementation project' } },
      { feature: 'Free tier', us: { kind: 'yes', note: 'Free in beta' }, them: { kind: 'no' } },
    ],
    whenToPickThem: [
      'You’re a large support org that needs enterprise ticketing, SLAs, and complex routing.',
      'Your priority is deflecting and managing inbound support volume at scale.',
      'You have admins to build and maintain flows.',
    ],
    whenToPickUs: [
      'Your goal is converting leads and booking, not running a ticket queue.',
      'You want voice + social channels and native CRM actions.',
      'You want to launch in an afternoon, not a quarter.',
      'You want agents that improve without a dedicated admin team.',
    ],
    faqs: [
      { q: 'Is Voxility a Zendesk replacement?', a: 'For sales/marketing AI agents, yes. For enterprise support ticketing with SLAs and complex routing, Zendesk is the heavier system — Voxility focuses on agents that qualify, book, and act in your CRM across channels.' },
      { q: 'How fast can we go live?', a: 'Minutes. Pick a voice, write instructions in plain English, add qualifying questions, and turn it on — no implementation project.' },
      { q: 'Does it integrate with our CRM?', a: 'Yes — native GoHighLevel Marketplace install and HubSpot integration, with the agent reading and writing data directly.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'tidio-alternative',
    competitor: 'Tidio',
    eyebrow: 'Tidio alternative',
    heading: 'A Tidio alternative with voice, native CRM actions, and self-improvement',
    metaTitle: 'Tidio alternative — AI agents for voice, chat & your CRM',
    metaDescription:
      'A Tidio (Lyro) alternative for teams who want more than a chat widget: Voxility AI agents work every channel including voice, take native CRM actions, and get better automatically. Free in beta.',
    hook: 'Tidio’s Lyro is a solid website chatbot. Voxility goes further — voice, social, and native CRM actions, with an agent that auto-improves from real conversations.',
    theirPitch:
      'Tidio is a popular, affordable live-chat and chatbot tool for small businesses, with its Lyro AI for answering common questions on your website. It’s easy to set up and great for basic website chat and simple automations.',
    ourAngle:
      'Voxility is a full multi-channel agent platform. Beyond website chat, it runs voice calls, SMS, and social DMs, takes 26+ native CRM actions in GoHighLevel/HubSpot, simulates against seven personas before launch, and auto-applies improvements from every conversation.',
    rows: [
      { feature: 'Website chat widget', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'AI answering from your content', us: { kind: 'yes' }, them: { kind: 'yes', note: 'Lyro' } },
      { feature: 'Voice calls', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'SMS, WhatsApp, Instagram, Facebook, GMB', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Native GoHighLevel + HubSpot actions', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'no' } },
      { feature: 'Books + qualifies in the CRM', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Self-improving + simulation testing', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Free tier', us: { kind: 'yes', note: 'Free in beta' }, them: { kind: 'yes', note: 'Limited' } },
    ],
    whenToPickThem: [
      'You want a simple, low-cost website chatbot and nothing more.',
      'Voice, social DMs, and deep CRM actions aren’t needed.',
      'You’re a very small team optimizing purely for price.',
    ],
    whenToPickUs: [
      'You need more than website chat — voice, SMS, and social from one agent.',
      'You want native CRM actions in GoHighLevel/HubSpot, not just answers.',
      'You want agents that improve automatically and are tested before launch.',
    ],
    faqs: [
      { q: 'Why pick Voxility over Tidio/Lyro?', a: 'If you only need a website chatbot, Tidio is fine. Voxility adds voice, social channels, 26+ native CRM actions, pre-launch simulation, and automatic self-improvement — built for converting leads, not just answering site visitors.' },
      { q: 'Does Voxility have a chat widget too?', a: 'Yes — an embeddable widget with optional voice and human handoff with a live queue, plus all the other channels.' },
      { q: 'Is there a free option?', a: 'Voxility is free during beta.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'drift-alternative',
    competitor: 'Drift',
    eyebrow: 'Drift alternative',
    heading: 'A Drift alternative for conversational marketing — with voice and CRM actions',
    metaTitle: 'Drift alternative — AI conversational marketing across every channel',
    metaDescription:
      'A Drift (Salesloft) alternative: Voxility AI agents run conversational marketing across chat, voice, SMS, and social, qualify and book natively in your CRM, and improve from every conversation.',
    hook: 'Drift pioneered conversational marketing chat. Voxility brings it to every channel — including voice — with native CRM actions and agents that get sharper each week.',
    theirPitch:
      'Drift (now part of Salesloft) is known for conversational marketing and chat-based pipeline generation, with playbooks, routing, and ABM features aimed at B2B marketing and SDR teams on the website.',
    ourAngle:
      'Voxility runs the same qualify-and-book motion but across voice, SMS, and social as well as chat, with native GoHighLevel/HubSpot actions and a self-improvement loop. It’s a fit for SMBs and agencies who want conversational marketing without enterprise pricing or setup.',
    rows: [
      { feature: 'Conversational marketing chat', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Routing + booking from chat', us: { kind: 'yes' }, them: { kind: 'yes' } },
      { feature: 'Voice calls', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'SMS, WhatsApp, Instagram, Facebook, GMB', us: { kind: 'yes' }, them: { kind: 'partial' } },
      { feature: 'Native GoHighLevel + HubSpot actions', us: { kind: 'yes', note: '26+ tools' }, them: { kind: 'partial' } },
      { feature: 'Self-improving from conversations', us: { kind: 'yes' }, them: { kind: 'no' } },
      { feature: 'Built for SMBs + agencies', us: { kind: 'yes' }, them: { kind: 'partial', note: 'Enterprise-leaning' } },
      { feature: 'Free tier', us: { kind: 'yes', note: 'Free in beta' }, them: { kind: 'no' } },
    ],
    whenToPickThem: [
      'You’re an enterprise B2B team deep in Salesloft’s ecosystem.',
      'Your motion is purely website chat + ABM and budget isn’t a constraint.',
      'You don’t need voice or a multi-channel agent.',
    ],
    whenToPickUs: [
      'You want conversational marketing across voice and social, not just website chat.',
      'You run on GoHighLevel/HubSpot and want native CRM actions.',
      'You’re an SMB or agency that wants the motion without enterprise pricing.',
      'You want agents that improve automatically.',
    ],
    faqs: [
      { q: 'Is Voxility a Drift alternative for SMBs?', a: 'Yes. It runs the qualify-route-book conversational motion across chat, voice, SMS, and social, with native CRM actions and flat pricing — without Drift/Salesloft’s enterprise footprint.' },
      { q: 'Can it do voice as well as chat?', a: 'Yes — inbound and outbound voice calls with natural voices, alongside every text channel.' },
      { q: 'Does it work with GoHighLevel?', a: 'Yes — it installs from the GoHighLevel Marketplace as a Sponsored Partner and acts natively in your CRM.' },
    ],
    updatedAt: '2026-06-17',
  },
]

export function findAlternative(slug: string): Alternative | undefined {
  return ALTERNATIVES.find((a) => a.slug === slug)
}
