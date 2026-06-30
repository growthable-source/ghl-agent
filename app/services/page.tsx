import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import DemoModal from '@/components/landing/DemoModal'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xovera.io'

export const metadata: Metadata = {
  title: 'Done-for-You Marketing Services — We run it for you | Xovera',
  description:
    'Xovera is software and a team. Done-for-you ad management, agent setup, lead-gen funnels, and reputation management — built on GoHighLevel by an official partner & reseller.',
  alternates: { canonical: `${SITE_URL}/services` },
  openGraph: {
    title: 'Done-for-You Marketing Services — We run it for you',
    description:
      'Software plus a team behind it: ad management, agent setup, funnels, and reputation — done for you.',
    url: `${SITE_URL}/services`,
    type: 'website',
  },
}

const DEMO_COPY = {
  heading: 'Book a strategy call',
  orgLabel: 'Business name',
  orgPlaceholder: 'Acme Inc.',
  emailPlaceholder: 'you@business.com',
}

type Service = { eyebrow: string; title: string; body: string; deliverables: string[]; icon: React.ReactNode }

const SERVICES: Service[] = [
  {
    eyebrow: 'Paid ads management',
    title: 'We run your Meta & Google ads',
    body: 'A managed-ads team plans, launches, and optimizes your campaigns — then every lead flows straight into your Xovera agent to be engaged and booked in seconds. You see cost-per-booked-appointment, not just cost-per-click.',
    deliverables: ['Campaign strategy & build', 'Creative & copy testing', 'Daily optimization', 'Lead-to-revenue reporting'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395M19.18 18.13c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
      </svg>
    ),
  },
  {
    eyebrow: 'Done-for-you agent setup',
    title: 'We build and train your AI agents',
    body: 'Our team configures your voice, chat, and SMS agents end-to-end — scripts, guardrails, knowledge, calendars, and CRM wiring — and stress-tests them against real personas before they ever touch a customer. You go live ready, not guessing.',
    deliverables: ['Agent build & prompt design', 'Knowledge base ingestion', 'CRM + calendar wiring', 'Pre-launch persona testing'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.02-.397-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Lead-gen funnel builds',
    title: 'We design funnels that convert',
    body: 'Landing pages, lead forms, and follow-up sequences built on HighLevel and wired to your agent — so the click-to-conversation handoff is instant. Designed, written, and measured by us.',
    deliverables: ['Landing pages & forms', 'Offer & copy', 'Automated follow-up', 'Conversion tracking'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    ),
  },
  {
    eyebrow: 'Reputation & review mgmt',
    title: 'We grow and protect your reputation',
    body: 'Automated review requests at the right moments, fast on-brand responses to every rating, and a steady climb in your star average — handled by us, so the reviews that win your next customer keep coming.',
    deliverables: ['Review request automation', 'Response handling', 'Reputation monitoring', 'Monthly reporting'],
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
      </svg>
    ),
  },
]

const STEPS = [
  { n: '1', title: 'Strategy call', body: 'We learn your goals, audience, and offer — and map exactly where we can move the needle fastest.' },
  { n: '2', title: 'We build it', body: 'Agents, funnels, ads, and reputation flows get set up and tested by our team, on your HighLevel account.' },
  { n: '3', title: 'We run & optimize', body: 'Campaigns launch, the agent works every lead, and we tune week over week against real outcomes.' },
  { n: '4', title: 'You see the numbers', body: 'Clear reporting on booked appointments, cost per acquisition, and revenue — not vanity metrics.' },
]

export default function ServicesPage() {
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />

      {/* ── Hero ── */}
      <section className="relative pt-16 pb-12 px-6 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.08), transparent 60%)' }} />
        <div className="relative z-10 max-w-[860px] mx-auto text-center">
          <div className="section-label mb-3">Done-for-you services</div>
          <h1 className="text-4xl md:text-[3.25rem] font-extrabold tracking-tight leading-[1.06] mb-5" style={{ color: 'var(--text-primary)' }}>
            It&apos;s software — and a <span className="text-gradient">team behind it</span>.
          </h1>
          <p className="text-lg leading-[1.6] max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Don&apos;t want to run it yourself? Our team builds your agents, runs your ads, designs your funnels, and manages your reputation — all on the HighLevel platform we build on as an official partner. You get outcomes, not another tool to learn.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <DemoModal {...DEMO_COPY} triggerLabel="Book a strategy call" source="services_hero" />
              <Link href="/start" className="btn-secondary">Or use the software yourself</Link>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>Built on GoHighLevel · Official partner &amp; reseller</p>
          </div>
        </div>
      </section>

      {/* ── Services ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="grid md:grid-cols-2 gap-4">
            {SERVICES.map((s) => (
              <div key={s.title} className="vox-card p-7">
                <div className="icon-box mb-5">{s.icon}</div>
                <div className="section-label mb-2">{s.eyebrow}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
                <p className="text-[0.9375rem] leading-[1.65] mb-5" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
                <ul className="space-y-1.5">
                  {s.deliverables.map((d) => (
                    <li key={d} className="flex items-center gap-2 text-[0.875rem]" style={{ color: 'var(--text-secondary)' }}>
                      <span style={{ color: 'var(--accent-primary)' }}>✓</span> {d}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How we work ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>How we work with you</h2>
            <p className="mt-2 text-[0.9375rem]" style={{ color: 'var(--text-secondary)' }}>A simple engagement, built to show results fast.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="vox-card p-6">
                <div className="text-sm font-bold mb-3" style={{ color: 'var(--accent-primary)' }}>{s.n}</div>
                <h3 className="text-[0.9375rem] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
                <p className="text-[0.875rem] leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[820px] mx-auto vox-card p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            Let&apos;s grow it together
          </h2>
          <p className="mb-7 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Book a strategy call and we&apos;ll show you exactly where Xovera — software and services — can win you more booked appointments this month.
          </p>
          <div className="flex flex-col items-center gap-3">
            <DemoModal {...DEMO_COPY} triggerLabel="Book a strategy call" source="services_cta" />
            <Link href="/integrations" className="text-sm underline" style={{ color: 'var(--accent-primary)' }}>
              or see what we integrate with →
            </Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
