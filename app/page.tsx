import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import { DashboardStatsMockup, MeetingMockup, AgentBuilderMockup } from '@/components/landing/LandingMockups'
import MarketingFooter from '@/components/landing/MarketingFooter'
import EmailCaptureForm from '@/components/landing/EmailCaptureForm'
import MeetingDemoModal from '@/components/landing/MeetingDemoModal'
import DemoVideoDrawer from '@/components/landing/DemoVideoDrawer'
import { GoHighLevelIcon } from '@/components/icons/brand-icons'
import { INTEGRATIONS, CHANNELS } from '@/lib/integrations-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xovera.io'

// Public demo agent ("Harry") — drives the Co-Pilot "try it" CTAs. Its
// publicKey gates the screen-share link (/copilot/live/<key>) and the demo
// meeting endpoint (/api/copilot/public/<key>/meeting).
const DEMO_PUBLIC_KEY = 'cpa_eULDA-kRF2FPObVnzdRQNS49'

// Demo video for the slide-out drawer. Paste a YouTube / Vimeo / Loom URL
// (or a self-hosted .mp4). Empty = the drawer shows a "coming soon" poster.
const DEMO_VIDEO_URL = ''

// INTEGRATIONS, CHANNELS, and MARKETPLACE_URL now live in
// @/lib/integrations-data so the homepage strip and the /integrations page
// share one source of truth.

// ────────────────────────────────────────────────────────────────────────
// JSON-LD structured data
// ────────────────────────────────────────────────────────────────────────
// Three schemas, one script each. Google understands and rewards these
// with rich-result treatment in SERPs:
//   - Organization: company-level info + brand logo
//   - SoftwareApplication: marks the product up as software so it can
//     win the product-rich-card / app-install-card treatment
//   - FAQPage: turns the FAQ section into expandable SERP entries
//
// Keep these in a single data block at page-bottom so the HTML payload
// stays near the top; search crawlers don't care about script position.
const ORG_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'Xovera',
  url: SITE_URL,
  logo: `${SITE_URL}/logo-color.svg`,
  description:
    'Conversational AI agents for sales and marketing teams. Self-improving agents that answer calls, respond to texts, qualify leads, and book appointments — natively connected to your existing CRM.',
  sameAs: [
    'https://xovera.canny.io',
  ],
}

const SOFTWARE_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Xovera',
  applicationCategory: 'BusinessApplication',
  operatingSystem: 'Web',
  description:
    'Conversational AI platform built for sales and marketing teams. AI agents answer inbound calls, respond to SMS/email/chat, qualify leads, book appointments, and get measurably better over time from every conversation they have. Connects to LeadConnector, HubSpot, and the rest of your existing stack.',
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    availability: 'https://schema.org/InStock',
    description: 'Free during beta',
  },
  featureList: [
    'Voice AI for inbound and outbound calls',
    'Co-Pilot: screen-aware AI that joins live Google Meet, Zoom, and Teams calls',
    'SMS, email, WhatsApp, Instagram, Facebook, Google Business, and live chat',
    'Live chat with human handoff, wait estimates, and a queue',
    'Native LeadConnector and HubSpot CRM integration',
    'Shopify commerce: product search and checkout inside the conversation',
    'Real-time appointment booking',
    'Simulation Swarm testing against 7 customer personas',
    'Auto-applied prompt improvements from every conversation',
    '26+ CRM tools the agent can call natively',
  ],
}

// FAQ schema — the questions below must match the <details> in the
// FAQ section byte-for-byte, otherwise Google penalises the mismatch.
// If you edit a question here, edit the corresponding FAQItem below.
const FAQ_SCHEMA = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'How does the agent actually get better?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Every completed conversation — real or simulated — gets automatically reviewed by a second AI auditor that knows your agent\'s configuration. When it spots a specific failure, it proposes a concrete prompt addition. Improvements scoped to your agent are applied automatically; improvements that would benefit every agent on the platform get reviewed and promoted selectively.',
      },
    },
    {
      '@type': 'Question',
      name: 'Can I test an agent before it talks to a real customer?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes — Simulation Swarm runs the same scenario through seven different personas in parallel: friendly, aggressive, passive, skeptical, confused, ready-to-buy, price-shopper. Each gives feedback about where your agent struggled, and the fixes land on the live agent automatically.',
      },
    },
    {
      '@type': 'Question',
      name: 'What CRMs does Xovera work with?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'LeadConnector (via the marketplace) and HubSpot today, with more on the way. We sync contacts, pipelines, calendars, and conversations. The agent reads and writes CRM data natively — no Zapier glue required.',
      },
    },
    {
      '@type': 'Question',
      name: 'Do I need to be technical to use Xovera?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. If you can fill out a form, you can build an agent. Pick a voice, write some instructions in plain English, add your qualifying questions, and go live. No code, no API keys, no developers.',
      },
    },
    {
      '@type': 'Question',
      name: 'How realistic do the voice calls sound?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Very. We use ElevenLabs with 100+ voice options. You can tune speed, tone, and personality. Most callers don\'t realize they\'re talking to an AI until you tell them.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does it cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Xovera is free during beta. Pricing lands as we exit beta, designed for agencies and SMBs.',
      },
    },
  ],
}

/**
 * Xovera landing page.
 *
 * Narrative: the *self-improving* AI agent. Most AI-voice products give
 * you a script-reader; Xovera agents start good and get measurably
 * better every day — from their own conversations, from simulations
 * the operator runs, and from improvements that other agents on the
 * platform discover. The "rising tide" is the differentiator.
 *
 * Structure:
 *   1. Hero (split: copy left, generated network illustration right)
 *   2. Stats strip
 *   3. Live call mockup (kept — it shows the product doing its job)
 *   4. The learning loop (new — self-improvement is the core story)
 *   5. Simulation swarm (new — test against every personality before
 *      going live)
 *   6. Features grid
 *   7. How it works
 *   8. Why Xovera (narrative card)
 *   9. Use cases
 *  10. FAQ (expanded to address the self-improvement question)
 *  11. Final CTA
 *  12. Footer
 */

/* ─── Icons ─── */
function PhoneIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  )
}
function MessageIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z" />
    </svg>
  )
}
function CalendarIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  )
}
function BoltIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  )
}
function CrmIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
    </svg>
  )
}
function ChartIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  )
}
function WaveformIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 010-5.304m5.304 0a3.75 3.75 0 010 5.304m-7.425 2.121a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  )
}
function SparkIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" />
    </svg>
  )
}
function BeakerIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.378-1.067 3.711a48.309 48.309 0 01-16.27 0c-1.717-.333-2.3-2.48-1.068-3.71L5 14.5" />
    </svg>
  )
}
function CheckIcon({ className = 'w-4 h-4', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  )
}
function ArrowIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  )
}
function ChevronIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
    </svg>
  )
}

/* ─── FAQ Accordion (pure CSS) ─── */
function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details className="group border-b border-[var(--border)] last:border-0">
      <summary className="flex items-center justify-between cursor-pointer py-5 text-[var(--text-primary)] font-semibold text-[0.9375rem] list-none [&::-webkit-details-marker]:hidden">
        {q}
        <ChevronIcon className="w-4 h-4 text-[var(--text-secondary)] transition-transform group-open:rotate-180" />
      </summary>
      <p className="pb-5 text-[var(--text-secondary)] text-[0.9375rem] leading-[1.65]">{a}</p>
    </details>
  )
}

export default function LandingPage() {
  // data-theme="soft-light" pins this subtree to the LIGHT palette so the
  // page renders consistently regardless of the visitor's global theme.
  // Every color below uses a theme token (var(--…)) — never hardcoded hex —
  // so contrast stays correct on the cream background. The .vox-card /
  // .btn-* / .icon-box classes already resolve their own per-theme values.
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>

      <MarketingNav
        links={[
          { href: '#features', label: 'Features' },
          { href: '#copilot', label: 'Co-Pilot' },
          { href: '/integrations', label: 'Integrations' },
          { href: '/services', label: 'Services' },
          { href: '#learning-loop', label: 'The loop' },
        ]}
      />

      {/* ═══ Hero — split: copy left, generated network visual right ═══ */}
      <section className="relative pt-20 pb-24 overflow-hidden">
        {/* Ambient glow behind the whole hero */}
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 75% 40%, rgba(250,77,46,0.08), transparent 60%)' }} />

        <div className="relative z-10 max-w-[1280px] mx-auto px-6 grid md:grid-cols-2 gap-12 items-center">
          <div className="max-w-xl">
            <span className="section-label inline-block mb-6">Built for sales &amp; marketing teams</span>
            <h1 className="font-extrabold tracking-tight leading-[1.05] mb-6" style={{ fontSize: 'clamp(2.25rem, 5.5vw, 4rem)' }}>
              Every lead, answered. Every demo, <span className="text-gradient">booked</span>.
            </h1>
            <p className="mb-10 leading-[1.65]" style={{ color: 'var(--text-secondary)', fontSize: '1.125rem' }}>
              Your team shouldn&apos;t be answering the same questions at 11pm. Xovera runs AI agents that handle inbound calls, texts, and chats end-to-end — qualifying every lead, booking demos mid-conversation, and getting measurably smarter from every interaction. Plugs into your existing tools in one click. Live in five minutes.
            </p>
            <div className="flex flex-col sm:flex-row items-start gap-4">
              <Link href="/login?mode=signup" className="btn-primary">
                Start building free
                <ArrowIcon />
              </Link>
              <DemoVideoDrawer videoUrl={DEMO_VIDEO_URL} triggerLabel="▶ Watch the 2-min demo" />
            </div>
            <Link
              href="/integrations"
              className="inline-flex items-center gap-2 mt-6 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors hover:bg-[var(--surface-secondary)]"
              style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)', border: '1px solid var(--border)' }}
            >
              <GoHighLevelIcon className="w-4 h-4" />
              Built on GoHighLevel · our preferred platform
            </Link>
            <p className="mt-5 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              Built on GoHighLevel · Live in under 5 minutes · Free while in beta
            </p>
          </div>

          {/* Right-side hero visual — a code-built dashboard mockup (theme
              tokens, no static asset) that shows the outcome the copy
              promises: conversations handled, demos booked, live activity. */}
          <div className="relative w-full max-w-[520px] mx-auto md:ml-auto">
            <DashboardStatsMockup />
          </div>
        </div>
      </section>

      {/* ═══ Stats strip ═══ */}
      <section className="border-y py-14 px-6" style={{ borderColor: 'var(--border)' }}>
        <div className="max-w-[1280px] mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { value: '7', label: 'Personas tested per swarm' },
            { value: '26+', label: 'CRM tools the agent can call' },
            { value: '~30s', label: 'From feedback to applied fix' },
            { value: '<5 min', label: 'Setup time' },
          ].map((s) => (
            <div key={s.label}>
              <div className="stat-value mb-2">{s.value}</div>
              <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ═══ Co-Pilot — marquee new feature ═══ */}
      <section id="copilot" className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.07), transparent 60%)' }} />
        <div className="relative z-10 max-w-[1280px] mx-auto">
          <div className="text-center mb-12">
            <span className="section-label inline-block mb-4">New — Co-Pilot</span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">Your AI, right there on the call.</h2>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
              Co-Pilot watches a shared screen and talks your customer through it in real time — and it can join your Google
              Meet, Zoom, or Teams call as a participant. Onboarding, support, and live demos, handled.
            </p>
          </div>
          {/* Code-built meeting mockup — themed recreation of a video call
              with the AI Agent tile writing a live summary. No stock photo. */}
          <div className="max-w-2xl mx-auto mb-12">
            <MeetingMockup />
          </div>
          <div className="grid sm:grid-cols-3 gap-4 max-w-4xl mx-auto mb-10">
            {[
              { icon: <SparkIcon className="w-4 h-4" />, title: 'Sees the screen', body: 'Guides the user through your product live, step by step.' },
              { icon: <PhoneIcon className="w-4 h-4" />, title: 'Joins the meeting', body: 'Drop it into a Meet, Zoom, or Teams call as a real participant.' },
              { icon: <BoltIcon className="w-4 h-4" />, title: 'Learns each call', body: 'Every session can teach the agent to handle the next one better.' },
            ].map((k) => (
              <div key={k.title} className="vox-card p-6">
                <div className="icon-box mb-4">{k.icon}</div>
                <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{k.title}</h3>
                <p className="text-sm leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{k.body}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href={`/copilot/live/${DEMO_PUBLIC_KEY}`} className="btn-primary">
              Try the live demo
              <ArrowIcon />
            </Link>
            <MeetingDemoModal publicKey={DEMO_PUBLIC_KEY} />
          </div>
          <p className="text-center mt-4 text-xs" style={{ color: 'var(--text-tertiary)' }}>
            No signup · Capped at 10 minutes · Share your screen or drop it into a meeting
          </p>
        </div>
      </section>

      {/* ═══ Live conversation mockup ═══ */}
      <section className="max-w-4xl mx-auto px-6 py-24">
        <div className="text-center mb-10">
          <span className="section-label inline-block mb-3">A real call</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">This is what a Xovera agent sounds like.</h2>
        </div>
        <div className="vox-card overflow-hidden" style={{ boxShadow: '0 4px 40px rgba(0,0,0,0.08)' }}>
          <div className="flex items-center gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
              <div className="w-3 h-3 rounded-full" style={{ background: 'var(--surface-tertiary)' }} />
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-tertiary)' }}>
              <WaveformIcon className="w-4 h-4" />
              <span>Live call — Sarah (Inbound)</span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent-emerald)' }} />
              <span className="text-xs" style={{ color: 'var(--accent-emerald)' }}>Recording</span>
            </div>
          </div>
          <div className="p-6 space-y-5 text-sm" style={{ fontFamily: 'var(--font-dm-mono), monospace' }}>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-blue)' }}>Caller</span>
              <span style={{ color: 'var(--text-secondary)' }}>Hi, I saw your ad about the kitchen remodel special. Is that still going on?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-primary)' }}>Agent</span>
              <span style={{ color: 'var(--text-primary)' }}>Absolutely. The spring special runs through April — 15% off full kitchen remodels. Mind if I ask a couple of questions to see what we can do for you?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-blue)' }}>Caller</span>
              <span style={{ color: 'var(--text-secondary)' }}>Sure, go ahead.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-primary)' }}>Agent</span>
              <span style={{ color: 'var(--text-primary)' }}>What&apos;s your timeline looking like — hoping to start in the next month or two?</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-blue)' }}>Caller</span>
              <span style={{ color: 'var(--text-secondary)' }}>Yeah, ideally next month. We already have a design in mind.</span>
            </div>
            <div className="flex gap-3">
              <span className="shrink-0 w-16 text-right font-medium" style={{ color: 'var(--accent-primary)' }}>Agent</span>
              <span style={{ color: 'var(--text-primary)' }}>
                Perfect. I have availability this Thursday at 2 PM or Friday at 10 AM for a consultation. Which works better?
              </span>
            </div>
            <div className="ml-[76px] pl-4" style={{ borderLeft: '2px solid rgba(250,77,46,0.3)' }}>
              <div className="inline-flex items-center gap-2 text-xs rounded-md px-3 py-1.5" style={{ color: 'rgba(250,77,46,0.8)', background: 'rgba(250,77,46,0.08)' }}>
                <CalendarIcon className="w-3.5 h-3.5" />
                <span>book_appointment — Thursday 2:00 PM</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ THE LEARNING LOOP — the differentiator ═══ */}
      <section id="learning-loop" className="py-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 30% 50%, rgba(250,77,46,0.06), transparent 60%)' }} />
        <div className="relative z-10 max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">The learning loop</span>
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight mb-4">It starts good. It gets better. Automatically.</h2>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
              Every AI agent claims it&apos;s &ldquo;powered by GPT-X.&rdquo; Ours actually improves. Here&apos;s how.
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-10 items-center">
            {/* Left: code-built agent-builder mockup showing the auditor's
                proposed fix being applied to the live prompt — the exact
                moment the four steps on the right describe. */}
            <div className="relative w-full max-w-[480px] mx-auto md:mx-0">
              <AgentBuilderMockup />
            </div>

            {/* Right: the four steps */}
            <div className="space-y-5">
              {[
                {
                  step: '01',
                  title: 'Every conversation gets reviewed',
                  body: 'After a real customer call or text wraps up, a second AI auditor reads the transcript. It knows your agent\'s configuration, its rules, its business context — and looks for specific things the agent got wrong.',
                },
                {
                  step: '02',
                  title: 'Specific, apply-able fixes',
                  body: 'The auditor doesn\'t hand you generic advice. It proposes concrete prompt additions like "Never ask for information the contact has already given" — tied to a specific turn where it happened.',
                },
                {
                  step: '03',
                  title: 'Applied in ~30 seconds',
                  body: 'Approved improvements land on your agent\'s prompt immediately. The very next inbound uses the improved version. No redeploy, no "submit for review," no human in the critical path.',
                },
                {
                  step: '04',
                  title: 'Rising tide across the platform',
                  body: 'Universally-useful fixes (e.g., "never fabricate calendar times") can be promoted by us to every agent. Your agent benefits from what everyone else\'s agent learned — and vice versa.',
                },
              ].map((item) => (
                <div key={item.step} className="flex gap-4">
                  <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold" style={{ background: 'rgba(250,77,46,0.12)', color: 'var(--accent-primary)' }}>
                    {item.step}
                  </div>
                  <div>
                    <h3 className="font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{item.title}</h3>
                    <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Simulation Swarm callout ═══ */}
      <section className="py-20 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="vox-card p-10 md:p-14 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-secondary) 100%)' }}>
            <div className="absolute -right-20 -top-20 w-80 h-80 rounded-full pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(250,77,46,0.12), transparent 70%)' }} />
            <div className="relative z-10 max-w-3xl">
              <span className="inline-flex items-center gap-2 section-label mb-4">
                <SparkIcon className="w-3.5 h-3.5" />
                Before you go live
              </span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-5">
                Test your agent against <span className="text-gradient">every personality type</span> — in one click.
              </h2>
              <p className="text-[0.9375rem] md:text-base leading-[1.65] mb-8" style={{ color: 'var(--text-secondary)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>Simulation Swarm</strong> spins up seven parallel conversations against your agent, each with a different persona — friendly, aggressive, passive, skeptical, confused, ready-to-buy, price-shopper. Each one reacts to the same scenario in their own style. Your agent has to handle all of them.
              </p>
              <div className="grid sm:grid-cols-3 gap-6 mb-8">
                {[
                  { icon: <BeakerIcon className="w-4 h-4" />, label: 'One scenario, 7 personalities' },
                  { icon: <SparkIcon className="w-4 h-4" />, label: 'Findings auto-apply to the prompt' },
                  { icon: <WaveformIcon className="w-4 h-4" />, label: 'Broad coverage in ~7 minutes' },
                ].map(k => (
                  <div key={k.label} className="flex items-start gap-3">
                    <div className="icon-box shrink-0" style={{ width: '2rem', height: '2rem' }}>
                      {k.icon}
                    </div>
                    <span className="text-sm pt-1" style={{ color: 'var(--text-secondary)' }}>{k.label}</span>
                  </div>
                ))}
              </div>
              <Link href="/login?mode=signup" className="btn-primary">
                Try a swarm
                <ArrowIcon />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Features ═══ */}
      <section id="features" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">Features</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Everything the agent does</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>One platform replacing a team of SDRs, receptionists, and follow-up assistants — and it gets better at the job over time.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="vox-card p-7">
              <div className="icon-box mb-5"><SparkIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Co-Pilot on live calls</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                A screen-aware AI that guides customers in real time and joins your Google Meet, Zoom, or Teams calls as a participant — for onboarding, support, and live demos.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Shared-screen guidance</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Joins live meetings</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Learns from each session</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><MessageIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Live chat + human queue</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                The AI handles chat, then hands off to your team with routing, a real wait estimate, and a while-you-wait mini-game — so nobody bounces while they hold.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Smart handoff + routing</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Position + wait estimate</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />AI keeps helping in queue</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><BoltIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Commerce, in the conversation</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Connect your store and the agent searches your live catalog, checks stock, tracks orders, and sends a one-tap checkout link — right inside the chat.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Live product + stock lookup</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Order tracking + checkout</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />On-the-fly discount codes</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><BeakerIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Knows your business</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Feed it your website, documents, and live data sources. The agent answers from what you taught it — and stays grounded instead of guessing.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Sites, docs + live feeds</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Grounded, cited answers</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Test what it retrieves</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><CrmIcon /></div>
              <h3 className="text-lg font-semibold mb-2">White-label portals</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Give every client their own branded portal on a custom domain — your logo, your colors. Built for agencies reselling under their own name.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Custom domains</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Per-brand logo + colors</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Agency-ready</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><PhoneIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Voice AI</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Answers inbound calls and places outbound ones through your CRM workflows. Handles objections, qualifies in plain English, books during the call.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />100+ ElevenLabs voices</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />In-browser test calls</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Full transcript + recording</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><MessageIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Multi-channel messaging</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                SMS, email, Instagram, Facebook, Google Business, WhatsApp, and live chat. One agent brain, full conversation memory across channels.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />7 channels, single agent</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Conversations sync to CRM</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Auto follow-ups + drips</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><BeakerIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Simulations + swarms</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Pressure-test every new agent configuration against synthetic customers before a real one calls. Run a single persona or a full swarm.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />7 persona styles built-in</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Auto-review after each run</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Findings apply to your prompt</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><ChartIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Lead qualification + scoring</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Define qualifying questions in plain English. Answers map to CRM fields and lead scores. Hot leads get tagged, moved through pipelines, and flagged.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Custom questions per agent</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Automatic scoring + tagging</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Pipeline stage changes</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><CalendarIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Appointment booking</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Checks real-time availability and books mid-conversation. Works with your CRM calendar. Confirmations and reminders go out automatically.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Live availability checking</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Books during calls or texts</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Timezone-aware scheduling</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><CrmIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Plugs into your existing stack</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                Built on GoHighLevel (our preferred platform) or connect HubSpot — your call. Agents read and write your CRM natively — tag contacts, update custom fields, move pipeline stages, enroll in workflows, log every interaction. No Zapier glue, no engineering ticket.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Built on GoHighLevel · HubSpot too</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Native HubSpot integration</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Full audit trail</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><SparkIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Inline feedback</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-4" style={{ color: 'var(--text-secondary)' }}>
                See a reply you don&apos;t like in the playground? Thumbs down, add a note — the agent&apos;s prompt updates before the next turn. The fastest feedback loop in conversational AI.
              </p>
              <ul className="space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Per-reply thumbs</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Narrative → learning</li>
                <li className="flex items-center gap-2"><CheckIcon className="w-3.5 h-3.5" style={{ color: 'var(--accent-emerald)' }} />Retire if it misses</li>
              </ul>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><BoltIcon /></div>
              <h3 className="text-lg font-semibold mb-2">26+ CRM-native tools</h3>
              <p className="text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                Agents don&apos;t just talk — they act. Book appointments, check calendars, tag contacts, update pipelines, enroll in workflows, create tasks, transfer to a human, schedule follow-ups. All mid-conversation.
              </p>
            </div>

            <div className="vox-card p-7">
              <div className="icon-box mb-5"><WaveformIcon /></div>
              <h3 className="text-lg font-semibold mb-2">Approval + audit, built-in</h3>
              <p className="text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                Optional human-approval queue for sensitive replies. Every action the agent takes is logged. Every prompt change is versioned. You&apos;re always in control.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Orange divider ═══ */}
      <div className="max-w-[1280px] mx-auto px-6"><hr className="orange-rule" /></div>

      {/* ═══ Integrations + Sponsored Partner ═══ */}
      <section id="integrations" className="py-24 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <span className="section-label inline-block mb-4">Integrations &amp; channels</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Plugs into your stack. Shows up on every channel.</h2>
            <p className="max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>
              Built on GoHighLevel — our preferred platform — and connected to the tools you already run and the channels your customers actually use. We layer on top; we don&apos;t replace your stack.
            </p>
          </div>

          {/* HighLevel: the platform we build on */}
          <Link
            href="/integrations"
            className="vox-card p-6 md:p-7 flex items-center gap-5 mb-10 transition-colors hover:border-[var(--accent-primary)]"
          >
            <div className="icon-box shrink-0" style={{ width: '3rem', height: '3rem' }}>
              <GoHighLevelIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Built on GoHighLevel</h3>
                <span className="text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>Our preferred platform</span>
              </div>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>As a GoHighLevel partner, we build on HighLevel and bring it to you fully set up — no install or migration required.</p>
            </div>
            <span className="ml-auto shrink-0 hidden sm:inline text-sm font-medium" style={{ color: 'var(--accent-primary)' }}>See integrations →</span>
          </Link>

          {/* Integrations row */}
          <div className="mb-10">
            <div className="text-xs uppercase tracking-wider font-semibold mb-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Integrates with</div>
            <div className="flex flex-wrap justify-center gap-3">
              {INTEGRATIONS.map((it) => (
                <div key={it.label} className="vox-card flex items-center gap-2.5 px-4 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                  <span style={{ color: 'var(--text-primary)' }}><it.Icon className="w-5 h-5" /></span>
                  <span className="text-sm font-medium">{it.label}</span>
                </div>
              ))}
              <div className="vox-card flex items-center px-4 py-2.5 text-sm font-medium" style={{ color: 'var(--text-tertiary)' }}>+ many more</div>
            </div>
          </div>

          {/* Channels row */}
          <div>
            <div className="text-xs uppercase tracking-wider font-semibold mb-4 text-center" style={{ color: 'var(--text-tertiary)' }}>Operates across</div>
            <div className="flex flex-wrap justify-center gap-3">
              {CHANNELS.map((c) => (
                <div key={c.label} className="flex items-center gap-2.5 px-4 py-2.5 rounded-full" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>
                  <c.Icon className="w-5 h-5" />
                  <span className="text-sm font-semibold">{c.label}</span>
                </div>
              ))}
              <div className="flex items-center px-4 py-2.5 rounded-full text-sm font-semibold" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>+ more</div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ How it works ═══ */}
      <section id="how-it-works" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">How it works</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Four steps. One afternoon.</h2>
            <p style={{ color: 'var(--text-secondary)', fontSize: '1.0625rem' }}>No developers. No month-long setup. No integration fees.</p>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { step: '01', title: 'Connect your CRM', desc: 'Built on GoHighLevel, or connect HubSpot. Contacts, pipelines, and calendars sync automatically.' },
              { step: '02', title: 'Build your agent', desc: 'Persona, knowledge, qualifying questions, voice. Plain English only — no code.' },
              { step: '03', title: 'Swarm-test it', desc: 'Run one scenario against every personality type. Fix what breaks before a real customer sees it.' },
              { step: '04', title: 'Go live, let it learn', desc: 'Flip it on. It answers calls, texts, qualifies, books — and improves from every conversation.' },
            ].map((item) => (
              <div key={item.step} className="vox-card p-7">
                <div className="stat-value mb-4" style={{ fontSize: '1.75rem' }}>{item.step}</div>
                <h3 className="text-[0.9375rem] font-semibold mb-2">{item.title}</h3>
                <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Why Xovera ═══ */}
      <section className="py-8 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="vox-card p-10 md:p-16" style={{ background: 'linear-gradient(135deg, var(--surface) 0%, var(--surface-secondary) 100%)' }}>
            <div className="max-w-3xl">
              <span className="section-label inline-block mb-4">Why Xovera</span>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">
                This isn&apos;t a chatbot with a phone number.
              </h2>
              <div className="space-y-4 text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
                <p>
                  Most &ldquo;AI voice&rdquo; products give you a script reader that falls apart the moment a customer asks a real question. The fix has always been the same: stop the agent, edit the prompt, redeploy, pray.
                </p>
                <p>
                  Xovera agents are different. They know your business because you teach them — with a knowledge base, qualifying questions, and a persona that matches your brand. They have <strong style={{ color: 'var(--text-primary)' }}>26+ CRM-native tools</strong> to actually do things: check calendars, book appointments, tag leads, send texts, update pipelines.
                </p>
                <p>
                  And every single conversation makes them better. A dedicated AI reviewer audits every call, every text exchange, and every simulation — proposing concrete prompt improvements that apply to the live agent in about thirty seconds. Tomorrow&apos;s agent is measurably sharper than today&apos;s, without you opening a single settings page.
                </p>
                <p>
                  That&apos;s the bet. Agents that start good. Get better. <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Every single day.</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Services teaser — software + a team behind it ═══ */}
      <section className="py-24 px-6">
        <div className="max-w-[1100px] mx-auto">
          <div className="vox-card p-8 md:p-12">
            <div className="grid md:grid-cols-2 gap-8 items-center">
              <div>
                <span className="section-label inline-block mb-4">Software + services</span>
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">Don&apos;t want to run it yourself? We will.</h2>
                <p className="text-[0.9375rem] leading-[1.65] mb-6" style={{ color: 'var(--text-secondary)' }}>
                  Xovera isn&apos;t just a tool — it&apos;s a team. Our specialists run your ads, build your agents, design your funnels, and manage your reputation on the HighLevel platform we build on as an official partner. You get booked appointments, not homework.
                </p>
                <div className="flex flex-col sm:flex-row gap-3">
                  <Link href="/services" className="btn-primary">Explore done-for-you services</Link>
                  <Link href="/integrations" className="btn-secondary">See integrations</Link>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { t: 'Paid ads management', d: 'We run Meta & Google' },
                  { t: 'Done-for-you agent setup', d: 'Built & trained for you' },
                  { t: 'Lead-gen funnels', d: 'Pages that convert' },
                  { t: 'Reputation management', d: 'More 5-star reviews' },
                ].map((s) => (
                  <div key={s.t} className="rounded-xl p-4" style={{ background: 'var(--surface-secondary)', border: '1px solid var(--border)' }}>
                    <div className="text-[0.875rem] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>{s.t}</div>
                    <div className="text-[0.75rem]" style={{ color: 'var(--text-tertiary)' }}>{s.d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ Mid-page CTA strip ═══ */}
      <section className="py-20 px-6 relative">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 50%, rgba(250,77,46,0.06), transparent 70%)' }} />
        <div className="relative z-10 max-w-3xl mx-auto text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-4">Ready to stop missing calls?</h2>
          <p className="mb-8 text-[0.9375rem]" style={{ color: 'var(--text-secondary)' }}>Build your first AI agent in under 5 minutes. Free while in beta.</p>
          <Link href="/login?mode=signup" className="btn-primary">
            Start building free
            <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* ═══ Use cases ═══ */}
      <section id="use-cases" className="py-24 px-6">
        <div className="max-w-[1280px] mx-auto">
          <div className="text-center mb-16">
            <span className="section-label inline-block mb-4">Use cases</span>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-4">Built for businesses that live on the phone</h2>
          </div>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { title: 'Home services', desc: 'HVAC, plumbing, roofing, remodeling. Qualify jobs, book estimates, follow up on quotes — without office staff.' },
              { title: 'Real estate', desc: 'Answer property inquiries 24/7. Qualify buyers, schedule showings, and push hot leads to the top of your pipeline.' },
              { title: 'Healthcare', desc: 'Patient intake, appointment scheduling, and follow-up reminders. Reduce no-shows without adding front desk staff.' },
              { title: 'Legal', desc: 'Screen potential clients, gather case details, and book consultations. Route qualified leads to the right attorney.' },
              { title: 'Agencies', desc: 'White-label for your clients. Each sub-account gets its own agent, persona, and phone number. Scale without headcount.' },
              { title: 'Auto + dealerships', desc: 'Service booking, test drives, and lead follow-up. Handle the call volume that kills conversion rates.' },
            ].map((uc) => (
              <div key={uc.title} className="vox-card p-7">
                <h3 className="text-[0.9375rem] font-semibold mb-2">{uc.title}</h3>
                <p className="text-sm leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{uc.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ═══ Orange divider ═══ */}
      <div className="max-w-[1280px] mx-auto px-6"><hr className="orange-rule" /></div>

      {/* ═══ FAQ ═══ */}
      <section id="faq" className="py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <span className="section-label inline-block mb-4">FAQ</span>
            <h2 className="text-3xl font-bold tracking-tight">Common questions</h2>
          </div>

          <div className="vox-card p-6 md:p-8">
            <FAQItem
              q="How does the agent actually &ldquo;get better&rdquo;?"
              a="Every completed conversation — real or simulated — gets automatically reviewed by a second AI auditor that knows your agent's configuration. When it spots a specific failure (asking for info the contact already gave, promising an action it didn't take, missing an obvious close), it proposes a concrete prompt addition. Improvements scoped to your agent are applied automatically; improvements that would benefit every agent on the platform get reviewed by us and promoted selectively."
            />
            <FAQItem
              q="Can I test an agent before it talks to a real customer?"
              a="Yes — Simulation Swarm runs the same scenario through seven different personas in parallel: friendly, aggressive, passive, skeptical, confused, ready-to-buy, price-shopper. Each gives feedback about where your agent struggled, and the fixes land on the live agent automatically. Broad coverage in about seven minutes."
            />
            <FAQItem
              q="What if I don't like a change the AI made to my prompt?"
              a="Every applied learning shows up on the conversation or swarm detail page with a Retire button. One click reverts it cleanly. We also version every prompt change — you can see exactly what shifted and when."
            />
            <FAQItem
              q="What CRMs does Xovera work with?"
              a="LeadConnector (via the marketplace) and HubSpot today, with more on the way. We sync contacts, pipelines, calendars, and conversations. The agent reads and writes CRM data natively — no Zapier glue required."
            />
            <FAQItem
              q="How realistic do the voice calls sound?"
              a="Very. We use ElevenLabs with 100+ voice options. You can tune speed, tone, and personality. Most callers don't realize they're talking to an AI until you tell them."
            />
            <FAQItem
              q="Do I need to be technical to use Xovera?"
              a="No. If you can fill out a form, you can build an agent. Pick a voice, write some instructions in plain English, add your qualifying questions, and go live. No code, no API keys, no developers."
            />
            <FAQItem
              q="What happens if the agent genuinely can't answer something?"
              a="You configure fallback behavior — it can transfer to a human, take a message, or offer to call back. You set the rules, and the agent follows them. A guardrail also prevents it from ever claiming an action happened when the corresponding tool wasn't actually called — no fabricated confirmations."
            />
            <FAQItem
              q="How much does it cost?"
              a="Xovera is free during beta. Pricing lands as we exit beta, designed for agencies and SMBs — no surprises, no per-minute math homework."
            />
          </div>
        </div>
      </section>

      {/* ═══ Email capture — launch updates ═══ */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto vox-card p-8 md:p-12 text-center">
          <span className="section-label inline-block mb-3">Stay in the loop</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3">Get product updates as we ship them.</h2>
          <p className="mb-6 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            New features land every week. Drop your email and we&apos;ll keep you posted — no spam, unsubscribe anytime.
          </p>
          <div className="flex justify-center">
            <EmailCaptureForm source="homepage_band" cta="Keep me posted" />
          </div>
        </div>
      </section>

      {/* ═══ Final CTA ═══ */}
      <section className="relative py-32 px-6">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(circle at 50% 40%, rgba(250,77,46,0.1), transparent 60%)' }} />
        <div className="relative z-10 max-w-2xl mx-auto text-center">
          <span className="section-label inline-block mb-4">Get started</span>
          <h2 className="font-bold tracking-tight mb-6" style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)' }}>
            Your agents should be smarter in a month.<br />
            <span className="text-gradient">Ours actually are.</span>
          </h2>
          <p className="mb-10 text-[1.0625rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
            Build your first AI agent in under 5 minutes. Free while in beta.
          </p>
          <Link href="/login?mode=signup" className="btn-primary text-base py-3 px-8">
            Get started free
            <ArrowIcon />
          </Link>
        </div>
      </section>

      {/* ═══ Footer ═══ */}
      <MarketingFooter />

      {/* ═══ JSON-LD structured data ═══
          Three schemas inlined for rich-result eligibility. Google, Bing,
          and DuckDuckGo all parse these. Kept at the bottom of the
          render tree because crawlers don't care about position and the
          HTML above stays lean. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_SCHEMA) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(SOFTWARE_SCHEMA) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(FAQ_SCHEMA) }}
      />
    </div>
  )
}
