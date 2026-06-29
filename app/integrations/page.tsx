import type { Metadata } from 'next'
import Link from 'next/link'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import { GoHighLevelIcon } from '@/components/icons/brand-icons'
import LogoMarquee from '@/components/landing/LogoMarquee'
import { INTEGRATION_GROUPS, CHANNELS, GYM_SYSTEMS } from '@/lib/integrations-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xovera.io'

export const metadata: Metadata = {
  title: 'Integrations — Works with your gym software, not instead of it | Xovera',
  description:
    'Xovera layers on top of the gym software you already run — Mindbody, ABC, Club Automation and more — to handle lead acquisition and marketing. Built on GoHighLevel, our preferred platform, and connected to Meta & Google Ads, HubSpot, Stripe, Calendly, Twilio, Slack and more.',
  alternates: { canonical: `${SITE_URL}/integrations` },
  openGraph: {
    title: 'Integrations — Works with your gym software, not instead of it',
    description:
      'Layers on top of the gym systems you already run. Built on GoHighLevel, our preferred platform.',
    url: `${SITE_URL}/integrations`,
    type: 'website',
  },
}

export default function IntegrationsPage() {
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      <MarketingNav />

      {/* ── Hero ── */}
      <section className="relative pt-16 pb-12 px-6 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.08), transparent 60%)' }} />
        <div className="relative z-10 max-w-[820px] mx-auto text-center">
          <div className="section-label mb-3">Integrations</div>
          <h1 className="text-4xl md:text-[3.25rem] font-extrabold tracking-tight leading-[1.06] mb-5" style={{ color: 'var(--text-primary)' }}>
            Works with your stack — <span className="text-gradient">not instead of it.</span>
          </h1>
          <p className="text-lg leading-[1.6] max-w-2xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Xovera layers on top of the gym and business software you already run to take over lead acquisition and marketing. Built on GoHighLevel — our preferred platform — and connected to your ad accounts, calendars, and channels. No rip-and-replace, no Zapier glue.
          </p>
        </div>
      </section>

      {/* ── Gym systems marquee — front and centre ── */}
      <section className="px-6 mb-16">
        <div className="max-w-[1100px] mx-auto text-center mb-7">
          <span className="section-label inline-block mb-3">Built for the systems gyms already run</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            Keep your gym software. We run the growth layer.
          </h2>
          <p className="max-w-2xl mx-auto text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
            Mindbody, ABC, Club Automation and the rest keep running your floor. Xovera sits on top to acquire and convert leads — some of these are live integrations today, the rest are quick for us to build.
          </p>
        </div>
        <LogoMarquee items={GYM_SYSTEMS} />
        <p className="text-center text-sm mt-6" style={{ color: 'var(--text-tertiary)' }}>
          Don&apos;t see your system?{' '}
          <Link href="/login?mode=signup" className="underline" style={{ color: 'var(--accent-primary)' }}>Tell us and we&apos;ll add it →</Link>
        </p>
      </section>

      {/* ── HighLevel: the platform we build on (preferred, not required) ── */}
      <section className="px-6 mb-16">
        <div className="max-w-[1000px] mx-auto">
          <div className="vox-card p-8 md:p-10 text-center relative overflow-hidden">
            <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 0%, rgba(232,68,37,0.10), transparent 65%)' }} />
            <div className="relative z-10">
              <div className="mx-auto mb-5 flex items-center justify-center rounded-2xl" style={{ width: '5rem', height: '5rem', background: 'var(--accent-primary-bg)' }}>
                <GoHighLevelIcon className="w-12 h-12" />
              </div>
              <div className="flex items-center justify-center gap-2 flex-wrap mb-3">
                <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
                  Built on GoHighLevel
                </h2>
                <span className="text-[10px] uppercase tracking-wider font-bold px-2.5 py-1 rounded-full" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>
                  Our preferred platform
                </span>
              </div>
              <p className="max-w-2xl mx-auto text-[0.9375rem] leading-[1.65] mb-7" style={{ color: 'var(--text-secondary)' }}>
                As a GoHighLevel partner, we build Xovera on HighLevel and bring it to you fully set up — you don&apos;t have to install it, learn it, or move your gym onto it. It powers the marketing layer; your gym software keeps running your gym. Prefer HubSpot? That works too.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/login?mode=signup" className="btn-primary">Start free</Link>
                <Link href="/services" className="btn-secondary">Or have us run it for you →</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Grouped integrations ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Connects to the tools you already run
            </h2>
          </div>
          <div className="space-y-10">
            {INTEGRATION_GROUPS.map((group) => (
              <div key={group.category}>
                <div className="mb-4">
                  <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{group.category}</h3>
                  <p className="text-sm" style={{ color: 'var(--text-tertiary)' }}>{group.caption}</p>
                </div>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {group.items.map((it) => (
                    <div key={it.label + group.category} className="vox-card p-5 flex items-start gap-3.5">
                      <div className="icon-box shrink-0" style={{ width: '2.75rem', height: '2.75rem' }}>
                        <span style={{ color: 'var(--text-primary)' }}><it.Icon className="w-6 h-6" /></span>
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-[0.9375rem] mb-0.5" style={{ color: 'var(--text-primary)' }}>{it.label}</div>
                        <p className="text-[0.8125rem] leading-[1.55]" style={{ color: 'var(--text-secondary)' }}>{it.blurb}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-center text-sm mt-8" style={{ color: 'var(--text-tertiary)' }}>
            …and thousands more via Zapier. Need a specific integration?{' '}
            <Link href="/login?mode=signup" className="underline" style={{ color: 'var(--accent-primary)' }}>Ask us →</Link>
          </p>
        </div>
      </section>

      {/* ── Channels ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1000px] mx-auto vox-card p-8 md:p-10">
          <div className="text-center mb-7">
            <span className="section-label inline-block mb-3">One agent, every channel</span>
            <h2 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Shows up wherever your customers are</h2>
          </div>
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
      </section>

      {/* ── CTA ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[820px] mx-auto vox-card p-8 md:p-12 text-center">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            Connect your stack in an afternoon
          </h2>
          <p className="mb-7 text-[0.9375rem] max-w-xl mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Link your tools and your agent is live across every channel — sitting on top of the gym software you already run. No developer required.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login?mode=signup" className="btn-primary">Start building free</Link>
            <Link href="/services" className="btn-secondary">Or have us set it up →</Link>
          </div>
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}
