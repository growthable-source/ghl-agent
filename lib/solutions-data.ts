/**
 * Solution / keyword SEO landing pages (problem-led, not head-to-head).
 * Each renders at a clean keyword URL (e.g. /ai-customer-service) via a thin
 * route folder + the shared SolutionPage template.
 */

export interface SolutionFeature {
  title: string
  body: string
}

export interface Solution {
  slug: string
  /** Uppercase eyebrow, e.g. 'AI customer service'. */
  eyebrow: string
  heading: string
  metaTitle: string
  metaDescription: string
  hook: string
  /** Lead paragraph under the hero. */
  intro: string
  features: SolutionFeature[]
  /** Three short outcome stats / proof points. */
  proof: { value: string; label: string }[]
  faqs: { q: string; a: string }[]
  updatedAt: string
}

export const SOLUTIONS: Solution[] = [
  {
    slug: 'ai-customer-service',
    eyebrow: 'AI customer service',
    heading: 'AI customer service that resolves, books, and updates your CRM',
    metaTitle: 'AI Customer Service Software — Xovera',
    metaDescription:
      'AI customer service across chat, email, SMS, social, and voice. Xovera answers from your knowledge base, books and qualifies in your CRM, hands off to humans with a live queue, and improves every week.',
    hook: 'Answer every customer, on every channel, day or night — with an AI agent that doesn’t just reply, it resolves and takes action in your CRM.',
    intro:
      'Most “AI customer service” is a website chatbot that deflects FAQs and stops there. Xovera runs a real agent across chat, email, SMS, WhatsApp, Instagram, Facebook, Google Business, and voice — grounded in your own knowledge, able to book appointments, update contacts, and escalate to a human with a live queue. And it gets measurably better from every conversation it has.',
    features: [
      { title: 'Every channel, one agent', body: 'Chat widget, email, SMS, social DMs, Google Business, and inbound/outbound voice — one brain with full conversation memory across all of them.' },
      { title: 'Grounded answers, not guesses', body: 'Feed it your website, docs, and live data sources. It answers from what you taught it, with a guardrail against claiming actions it didn’t take.' },
      { title: 'Resolves, doesn’t just deflect', body: 'Books appointments, tags contacts, updates fields, moves pipeline stages, and creates tickets — 26+ native CRM actions mid-conversation.' },
      { title: 'Human handoff with a live queue', body: 'When a person is needed, the chat routes to your team with a position, wait estimate, and a while-you-wait experience so nobody bounces.' },
      { title: 'Gets better every week', body: 'A second AI auditor reviews every conversation and applies concrete prompt improvements in about 30 seconds — no redeploys.' },
      { title: 'Tested before it goes live', body: 'Simulate against seven customer personas before a real one ever reaches it, so you ship with confidence.' },
    ],
    proof: [
      { value: '24/7', label: 'Coverage across every channel' },
      { value: '< 5 min', label: 'To set up and go live' },
      { value: '26+', label: 'CRM actions the agent can take' },
    ],
    faqs: [
      { q: 'What channels does the AI cover?', a: 'Live chat, email, SMS, WhatsApp, Instagram, Facebook, Google Business, and inbound/outbound voice calls — all from one agent.' },
      { q: 'Will it hand off to a human?', a: 'Yes. You set the rules; when a human is needed it routes to your team with a live queue, position, and wait estimate, and the AI keeps helping in the meantime.' },
      { q: 'Does it connect to my CRM?', a: 'Yes — it installs from the GoHighLevel Marketplace and integrates with HubSpot, and the agent reads and writes your CRM natively.' },
      { q: 'How is it different from a chatbot?', a: 'A chatbot answers. Xovera resolves — it books, qualifies, and updates your CRM, works voice and social, and improves automatically.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'ai-chat-widget-builder',
    eyebrow: 'AI chat widget builder',
    heading: 'Build an AI chat widget for your website in minutes',
    metaTitle: 'AI Chat Widget Builder — embed an AI agent on your site',
    metaDescription:
      'Build an AI chat widget that answers, qualifies, books, and hands off to a human with a live queue. Xovera’s embeddable widget supports voice, your branding, and native CRM actions. Free in beta.',
    hook: 'Drop a smart, on-brand AI chat widget on any site with one snippet — one that books, qualifies, and updates your CRM, not just answers.',
    intro:
      'Xovera’s chat widget is a full AI agent you embed with a single line of script. Customize the look to match your brand, let visitors talk or type, answer from your own knowledge, and hand off to a human with a live queue when needed — all wired into your CRM.',
    features: [
      { title: 'One-snippet install', body: 'Paste a single script tag on any website or landing page. Live in minutes, no developer required.' },
      { title: 'On-brand and configurable', body: 'Colors, logo, position, greeting, and behavior — match your brand and control exactly how the agent works.' },
      { title: 'Talk or type', body: 'Optional voice lets visitors speak instead of type, powered by natural voices.' },
      { title: 'Books + qualifies inline', body: 'The widget agent checks real availability, books appointments, captures lead details, and writes them straight to your CRM.' },
      { title: 'Human handoff + queue', body: 'Route to a teammate with a position and wait estimate, plus a while-you-wait mini-game so visitors stay engaged.' },
      { title: 'Self-improving', body: 'Every chat is auto-reviewed into prompt improvements, so the widget gets sharper over time.' },
    ],
    proof: [
      { value: '1 line', label: 'Script tag to install' },
      { value: 'Voice', label: 'Optional talk-to-the-agent mode' },
      { value: '∞', label: 'Widgets on the Scale plan' },
    ],
    faqs: [
      { q: 'How do I add the chat widget to my site?', a: 'Copy one script tag from your dashboard and paste it into your site’s HTML. It works on any platform — no plugins or developers needed.' },
      { q: 'Can the widget book appointments?', a: 'Yes — it checks live calendar availability and books during the conversation, writing the booking to your CRM.' },
      { q: 'Does it support voice?', a: 'Yes — you can enable a “talk instead” mode so visitors speak to the agent.' },
      { q: 'What happens when a human is needed?', a: 'The chat hands off to your team with a live queue and wait estimate, and the AI keeps assisting until someone picks it up.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'ai-receptionist',
    eyebrow: 'AI receptionist',
    heading: 'An AI receptionist that answers every call and books the job',
    metaTitle: 'AI Receptionist — answer every call, book every lead',
    metaDescription:
      'An AI receptionist that answers inbound calls 24/7, qualifies callers, books appointments on your calendar, and logs everything in your CRM. Natural voices, native GoHighLevel + HubSpot. Free in beta.',
    hook: 'Never miss a call again. Xovera answers the phone, qualifies the caller, and books the appointment — 24/7, in a natural voice, straight into your CRM.',
    intro:
      'A missed call is a missed customer. Xovera’s AI receptionist picks up every inbound call, answers questions about your business, qualifies the caller with your questions, and books them onto your calendar — then logs the whole interaction in your CRM. It sounds natural enough that most callers don’t realize it’s AI.',
    features: [
      { title: 'Answers 24/7', body: 'Every inbound call gets picked up — after hours, weekends, and when your team is slammed.' },
      { title: 'Natural voices', body: '100+ voice options you can tune for speed, tone, and personality to match your brand.' },
      { title: 'Qualifies the caller', body: 'Asks your qualifying questions, captures the answers to CRM fields, and scores the lead.' },
      { title: 'Books on your calendar', body: 'Checks real-time availability and books the appointment during the call, with confirmations and reminders.' },
      { title: 'Logs everything', body: 'Full transcript, recording, and outcome written to your CRM — nothing falls through the cracks.' },
      { title: 'Transfers when it should', body: 'You set the rules: take a message, transfer to a human, or offer a callback for anything it shouldn’t handle.' },
    ],
    proof: [
      { value: '0', label: 'Missed calls' },
      { value: '24/7', label: 'Always answers' },
      { value: '100+', label: 'Natural voice options' },
    ],
    faqs: [
      { q: 'Does it sound like a robot?', a: 'No — it uses natural ElevenLabs voices you can tune. Most callers don’t realize they’re talking to an AI until you tell them.' },
      { q: 'Can it book appointments?', a: 'Yes — it checks your live calendar availability and books during the call, with automatic confirmations and reminders.' },
      { q: 'What if it can’t handle a call?', a: 'You configure fallback behavior — transfer to a human, take a message, or offer a callback. It never invents an action it didn’t take.' },
      { q: 'Where do the call details go?', a: 'Everything — transcript, recording, captured fields — is written to your GoHighLevel or HubSpot CRM.' },
    ],
    updatedAt: '2026-06-17',
  },
  {
    slug: 'ai-sdr',
    eyebrow: 'AI SDR',
    heading: 'An AI SDR that qualifies, books, and follows up — automatically',
    metaTitle: 'AI SDR — automate lead qualification and booking',
    metaDescription:
      'An AI SDR that responds to inbound leads in seconds across chat, SMS, email, social, and voice, qualifies them, books meetings, and follows up — all inside GoHighLevel or HubSpot. Free in beta.',
    hook: 'Respond to every lead in seconds, qualify them, and book the meeting — an AI SDR that works every channel and never forgets to follow up.',
    intro:
      'Speed-to-lead wins deals, and humans can’t be awake 24/7. Xovera’s AI SDR engages inbound leads the moment they arrive — on chat, SMS, email, social, or voice — qualifies them with your criteria, books meetings on your reps’ calendars, and runs the follow-up sequence. Every action lands in your CRM, and the agent improves from every conversation.',
    features: [
      { title: 'Instant speed-to-lead', body: 'Engages new leads in seconds, any hour, before they go cold or click a competitor.' },
      { title: 'Qualifies with your criteria', body: 'Asks your qualifying questions, scores the lead, and tags hot ones for your reps.' },
      { title: 'Books meetings', body: 'Checks availability and books straight onto the right rep’s calendar mid-conversation.' },
      { title: 'Multi-channel follow-up', body: 'Runs follow-up across SMS, email, and social so leads don’t slip — without a human chasing them.' },
      { title: 'Native CRM actions', body: 'Moves pipeline stages, updates fields, enrolls in workflows, and logs every touch in GoHighLevel or HubSpot.' },
      { title: 'Improves over time', body: 'Auto-reviewed conversations turn into prompt improvements, so qualification gets sharper each week.' },
    ],
    proof: [
      { value: '< 30s', label: 'Speed-to-lead response' },
      { value: '24/7', label: 'Never off the clock' },
      { value: '26+', label: 'CRM actions per conversation' },
    ],
    faqs: [
      { q: 'What does an AI SDR actually do?', a: 'It responds to inbound leads instantly, qualifies them with your questions, books meetings on your reps’ calendars, and follows up across channels — all logged in your CRM.' },
      { q: 'Which channels does it cover?', a: 'Chat, SMS, email, WhatsApp, Instagram, Facebook, Google Business, and voice — one agent across all of them.' },
      { q: 'Does it replace my human reps?', a: 'It handles the repetitive speed-to-lead, qualification, and follow-up so your reps spend time with qualified, booked prospects. You stay in control with an optional approval queue.' },
      { q: 'Does it work with my CRM?', a: 'Yes — native GoHighLevel Marketplace install and HubSpot integration, with the agent taking actions directly in your CRM.' },
    ],
    updatedAt: '2026-06-17',
  },
]

export function findSolution(slug: string): Solution | undefined {
  return SOLUTIONS.find((s) => s.slug === slug)
}
