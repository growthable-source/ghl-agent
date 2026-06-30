import type { Metadata } from 'next'
import Link from 'next/link'
import Script from 'next/script'
import MarketingNav from '@/components/landing/MarketingNav'
import MarketingFooter from '@/components/landing/MarketingFooter'
import DemoModal from '@/components/landing/DemoModal'
import LogoMarquee from '@/components/landing/LogoMarquee'
import InlineLeadForm from '@/components/landing/InlineLeadForm'
import VoiceSampleButton from '@/components/landing/VoiceSampleButton'
import VoiceWebCall from '@/components/landing/VoiceWebCall'
import { GYM_SYSTEMS } from '@/lib/integrations-data'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xovera.io'

export const metadata: Metadata = {
  title: 'AI for Gyms & Fitness Studios — Never Miss a Lead | Xovera',
  description:
    'Xovera helps gyms and fitness studios across the US & Canada turn more leads into paying members: instant speed-to-lead, automatic routing to the right instructor or salesperson, and relentless follow-up that answers every call, text, and ad — 24/7, with nobody at the desk.',
  alternates: { canonical: `${SITE_URL}/ai-for-gyms` },
  openGraph: {
    title: 'AI for Gyms & Fitness Studios — Never Miss a Lead',
    description:
      'Instant speed-to-lead, ad automation, and a 24/7 voice AI receptionist — built for gyms and fitness studios in the US & Canada.',
    url: `${SITE_URL}/ai-for-gyms`,
    type: 'website',
  },
}

const PIXEL_ID = '1285462570417058'

// Niche copy for the shared demo modal so it reads "gym" everywhere.
const DEMO_COPY = {
  heading: 'Book your gym demo',
  orgLabel: 'Gym / studio name',
  orgPlaceholder: 'Iron House Fitness',
  emailPlaceholder: 'alex@yourgym.com',
}

// Three pillars, gym-framed. Each maps to a real Xovera capability.
const PILLARS: { eyebrow: string; title: string; body: string; icon: React.ReactNode }[] = [
  {
    eyebrow: 'Speed to lead',
    title: 'Reply in seconds, not hours',
    body: 'The instant someone fills out a form, DMs your page, or calls and you miss it, Xovera texts and calls back automatically — qualifies them and books a tour while they’re still interested. Leads contacted within five minutes convert dramatically more than ones you get to tomorrow.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
      </svg>
    ),
  },
  {
    eyebrow: 'Ad automation',
    title: 'Turn ad spend into booked tours',
    body: 'Connect your Meta and Google ads and every click that becomes a lead is instantly engaged, qualified, and booked — with the outcome written back to your CRM. See real cost-per-tour and cost-per-member, not just cost-per-click.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 110-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 01-1.44-4.282m3.102.069a18.03 18.03 0 01-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 018.835 2.535M10.34 6.66a23.847 23.847 0 008.835-2.535m0 0A23.74 23.74 0 0018.795 3m.38 1.125a23.91 23.91 0 011.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 001.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 010 3.46" />
      </svg>
    ),
  },
  {
    eyebrow: 'Voice AI agents',
    title: 'An AI receptionist that never misses a call',
    body: 'A natural, human-sounding voice answers every call 24/7 — handles “how much is membership?”, books trials and tours straight onto your calendar, and routes real issues to your team. Even at 11pm on a Sunday, no call goes to voicemail.',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
      </svg>
    ),
  },
]

const STEPS: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Connect your tools', body: 'Link your CRM, calendar, and ad accounts in a few minutes. No developer required.' },
  { n: '2', title: 'Xovera engages every lead', body: 'Web forms, DMs, missed calls, and ad clicks all get an instant, on-brand response by text and voice.' },
  { n: '3', title: 'Tours & trials get booked', body: 'The agent qualifies, answers questions, and books straight onto your calendar — then logs it in your CRM.' },
  { n: '4', title: 'You see members, not clicks', body: 'Every interaction is tracked end-to-end, so you know exactly which ads and channels fill your floor.' },
]

const FAQS: { q: string; a: string }[] = [
  { q: 'Does it work with my gym software?', a: 'Yes — and it doesn’t replace it. Keep Mindbody, ABC, Club Automation or whatever runs your gym; Xovera layers on top to handle lead acquisition and marketing. It’s built on GoHighLevel (our preferred platform) and also connects to HubSpot, so leads, tours, and members stay in sync. Don’t see your system? It’s quick for us to add.' },
  { q: 'What does it actually say to leads?', a: 'You set the script and guardrails. It answers questions about memberships, hours, and classes from your own info, qualifies the lead, and books a tour or free trial — it never invents pricing or promises you didn’t set.' },
  { q: 'Can it book tours and trials on my calendar?', a: 'Yes — it checks real-time availability and books during the conversation, with automatic confirmations and reminders to cut no-shows.' },
  { q: 'Does the voice sound like a robot?', a: 'No. It uses natural, human-sounding voices — most callers don’t realize they’re talking to an AI until you tell them.' },
  { q: 'Is this available in the US and Canada?', a: 'Yes — Xovera is built for gyms and fitness studios across both the US and Canada, with local phone numbers in both countries.' },
]

export default function GymsLandingPage() {
  return (
    <div data-theme="soft-light" className="min-h-screen overflow-hidden" style={{ background: 'var(--background)', color: 'var(--foreground)' }}>
      {/* ── Meta Pixel (scoped to this page) ── */}
      <Script id="meta-pixel-gyms" strategy="afterInteractive">
        {`!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${PIXEL_ID}');
fbq('track', 'PageView');`}
      </Script>
      <noscript>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img height="1" width="1" style={{ display: 'none' }} alt="" src={`https://www.facebook.com/tr?id=${PIXEL_ID}&ev=PageView&noscript=1`} />
      </noscript>

      <MarketingNav links={[]} showAnnouncement={false} logoHref="/ai-for-gyms" />

      {/* ── Hero — full-bleed background video with overlaid copy ── */}
      <section className="relative flex items-center justify-center overflow-hidden min-h-[clamp(560px,86vh,820px)] px-6 py-20">
        {/* Background video */}
        <video
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          poster="/landing/gym-hero-poster.jpg"
          aria-hidden="true"
        >
          <source src="/landing/gym-hero.mp4" type="video/mp4" />
        </video>

        {/* Legibility scrim — darkens the video so light copy stays readable */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(180deg, rgba(10,13,24,0.78) 0%, rgba(10,13,24,0.55) 45%, rgba(10,13,24,0.80) 100%)',
          }}
        />
        {/* Subtle brand wash from the corner */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 80% 15%, rgba(232,68,37,0.22), transparent 55%)' }}
        />

        {/* Copy */}
        <div className="relative z-10 max-w-[860px] mx-auto text-center">
          <div className="section-label mb-4" style={{ color: '#ff7a52' }}>For gyms &amp; fitness studios · US &amp; Canada</div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-[1.04] mb-5" style={{ color: '#ffffff' }}>
            Turn every lead into a <span className="text-gradient">paying member</span> — automatically.
          </h1>
          <p className="text-lg md:text-xl leading-[1.6] max-w-2xl mx-auto" style={{ color: 'rgba(255,255,255,0.88)' }}>
            The moment a lead comes in — call, text, DM, or ad — Xovera answers in seconds, routes it to the right instructor or salesperson, and follows up relentlessly until they&apos;re signed up and paying. Any hour, with nobody at the desk.
          </p>
          <div className="mt-9 flex flex-col items-center gap-3">
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <DemoModal {...DEMO_COPY} triggerLabel="Book a demo" source="gyms_hero" />
              <Link
                href="/login?mode=signup"
                className="inline-flex items-center justify-center rounded-full px-5 py-2.5 text-sm font-semibold transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.55)', color: '#ffffff' }}
              >
                Start free
              </Link>
            </div>
            <p className="text-xs" style={{ color: 'rgba(255,255,255,0.65)' }}>
              Built for gyms across the US &amp; Canada. Free while in beta — no card required.
            </p>
          </div>
        </div>
      </section>

      {/* ── Proof strip ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[900px] mx-auto grid grid-cols-3 gap-6 text-center border-y py-8" style={{ borderColor: 'var(--border)' }}>
          <div>
            <div className="stat-value mb-2">Seconds</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>To first response on every lead</div>
          </div>
          <div>
            <div className="stat-value mb-2">24/7</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Every call answered, day or night</div>
          </div>
          <div>
            <div className="stat-value mb-2">US + CA</div>
            <div className="text-xs font-medium" style={{ color: 'var(--text-tertiary)' }}>Local numbers in both countries</div>
          </div>
        </div>
      </section>

      {/* ── Works alongside your gym software (positioning + marquee) ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto text-center mb-9">
          <span className="section-label inline-block mb-3">Works with what you already run</span>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
            We don&apos;t replace your gym software. We run your growth on top of it.
          </h2>
          <p className="max-w-2xl mx-auto text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
            Keep Mindbody, ABC, Club Automation — whatever runs your floor. Xovera layers on top to take over lead acquisition and marketing: every inquiry answered, qualified, and booked. Built on GoHighLevel, our preferred platform, so you get enterprise-grade automation without running it yourself.
          </p>
        </div>
        <LogoMarquee items={GYM_SYSTEMS} />
        <p className="text-center text-sm mt-6" style={{ color: 'var(--text-tertiary)' }}>
          Don&apos;t see your system? We&apos;ll build the integration — it&apos;s quick.
        </p>
      </section>

      {/* ── Three pillars ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Three ways gyms grow with Xovera
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            {PILLARS.map((p) => (
              <div key={p.title} className="vox-card p-7">
                <div className="flex items-center justify-center w-11 h-11 rounded-xl mb-5" style={{ background: 'var(--gradient-primary)', color: '#fff', boxShadow: 'var(--shadow-primary)' }}>{p.icon}</div>
                <div className="section-label mb-2">{p.eyebrow}</div>
                <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{p.title}</h3>
                <p className="text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Dark band: watch it work (SMS mockup) ── */}
      <section className="relative overflow-hidden mb-20 py-20 px-6" style={{ background: 'linear-gradient(160deg, #0c1018 0%, #15182b 60%, #1d1326 100%)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 78% 20%, rgba(232,68,37,0.28), transparent 55%)' }} />
        <div className="relative z-10 max-w-[1100px] mx-auto grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <div className="section-label mb-3" style={{ color: '#ff7a52' }}>See it in action</div>
            <h2 className="text-3xl md:text-[2.5rem] font-extrabold tracking-tight leading-[1.08] mb-4" style={{ color: '#ffffff' }}>
              A missed inquiry at 9pm. <span className="text-gradient">A booked tour by 9:01.</span>
            </h2>
            <p className="text-[1.0625rem] leading-[1.6] mb-7" style={{ color: 'rgba(255,255,255,0.78)' }}>
              While your front desk is closed, Xovera texts back in seconds, answers the real questions, and books the tour straight onto your calendar — then logs it in your CRM. No lead left on read.
            </p>
            <div className="flex flex-wrap gap-6 mb-8">
              {[
                { v: '<60s', l: 'Avg. reply time' },
                { v: '3.2×', l: 'More tours booked' },
                { v: '0', l: 'Leads to voicemail' },
              ].map((s) => (
                <div key={s.l}>
                  <div className="text-2xl font-extrabold" style={{ color: '#ffffff' }}>{s.v}</div>
                  <div className="text-xs font-medium" style={{ color: 'rgba(255,255,255,0.55)' }}>{s.l}</div>
                </div>
              ))}
            </div>
            <DemoModal {...DEMO_COPY} triggerLabel="See it answer a lead live" source="gyms_mockup" />
          </div>

          {/* Phone-style SMS thread */}
          <div className="relative mx-auto w-full max-w-[380px]">
            <div className="absolute -inset-4 rounded-[2rem] pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 30%, rgba(232,68,37,0.30), transparent 70%)' }} />
            <div className="relative rounded-[1.75rem] p-4 sm:p-5" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.12)', backdropFilter: 'blur(4px)' }}>
              <div className="flex items-center gap-2 pb-3 mb-3 border-b" style={{ borderColor: 'rgba(255,255,255,0.10)' }}>
                <span className="w-2 h-2 rounded-full glow-pulse" style={{ background: '#22c55e' }} />
                <span className="text-xs font-semibold" style={{ color: 'rgba(255,255,255,0.85)' }}>Xovera · live</span>
                <span className="ml-auto text-[11px]" style={{ color: 'rgba(255,255,255,0.45)' }}>New lead · Meta ad</span>
              </div>
              <div className="space-y-2.5">
                <Bubble side="in">Hi, saw your ad — how much is membership? 👀</Bubble>
                <Bubble side="out">Hey! Thanks for reaching out 💪 Plans start at $39/mo. Want to swing by for a free day pass?</Bubble>
                <Bubble side="in">Yeah, tomorrow evening could work</Bubble>
                <Bubble side="out">Perfect — I&apos;ve got Thu 6:00pm open. Want me to lock it in?</Bubble>
                <Bubble side="in">Yes please 🙌</Bubble>
                <Bubble side="out">Booked! You&apos;ll get a reminder text. See you Thursday 🎉</Bubble>
              </div>
              <div className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold py-2 rounded-lg" style={{ background: 'rgba(34,197,94,0.14)', color: '#4ade80' }}>
                ✓ Tour booked · synced to CRM
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Run your own ads, or have us run them ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[1000px] mx-auto">
          <div className="text-center mb-9">
            <span className="section-label inline-block mb-3">Your ads, your call</span>
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight mb-3" style={{ color: 'var(--text-primary)' }}>
              Run the ads yourself — or hand us the keys
            </h2>
            <p className="max-w-2xl mx-auto text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>
              Either way it&apos;s the same platform and the same agent working every lead. Start hands-on, upgrade to fully managed whenever you want.
            </p>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="vox-card p-7">
              <div className="section-label mb-2">Self-serve</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Launch your own ads</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-5" style={{ color: 'var(--text-secondary)' }}>
                Build and launch Meta &amp; Google campaigns right inside the platform. Every click that becomes a lead is instantly engaged and booked — and you see real cost-per-tour, not just cost-per-click.
              </p>
              <ul className="space-y-1.5">
                {['Meta & Google in one place', 'Leads auto-engaged & booked', 'Cost-per-tour reporting'].map((d) => (
                  <li key={d} className="flex items-center gap-2 text-[0.875rem]" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--accent-primary)' }}>✓</span> {d}
                  </li>
                ))}
              </ul>
            </div>
            <div className="vox-card p-7 relative overflow-hidden">
              <span className="absolute top-5 right-5 text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-primary-bg)', color: 'var(--accent-primary)' }}>Managed</span>
              <div className="section-label mb-2">Done-for-you</div>
              <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Have us run them for you</h3>
              <p className="text-[0.9375rem] leading-[1.65] mb-5" style={{ color: 'var(--text-secondary)' }}>
                Upgrade to our managed-ads service and our team plans, launches, and optimizes the campaigns for you — it all still lives in your platform, so you keep full visibility and own everything.
              </p>
              <ul className="space-y-1.5 mb-5">
                {['We plan, launch & optimize', 'Creative & copy testing', 'You keep full visibility'].map((d) => (
                  <li key={d} className="flex items-center gap-2 text-[0.875rem]" style={{ color: 'var(--text-secondary)' }}>
                    <span style={{ color: 'var(--accent-primary)' }}>✓</span> {d}
                  </li>
                ))}
              </ul>
              <DemoModal {...DEMO_COPY} variant="link" triggerLabel="Ask us about managed ads →" source="gyms_managed_ads" />
            </div>
          </div>
        </div>
      </section>

      {/* ── Voice AI section (dark, animated phone) ── */}
      <section className="relative overflow-hidden mb-20 py-20 px-6" style={{ background: '#070708' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 25% 25%, rgba(232,68,37,0.22), transparent 55%)' }} />
        <div className="relative z-10 max-w-[1140px] mx-auto grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy + CTAs */}
          <div>
            <div className="section-label mb-3" style={{ color: '#ff7a52' }}>Voice AI receptionist</div>
            <h2 className="text-3xl md:text-[2.5rem] font-extrabold tracking-tight leading-[1.08] mb-4" style={{ color: '#ffffff' }}>
              Never miss another call — <span className="text-gradient">even at 11pm</span>.
            </h2>
            <p className="text-[1.0625rem] leading-[1.6] mb-6" style={{ color: 'rgba(255,255,255,0.78)' }}>
              A natural-sounding AI answers every call the second it rings — day, night, weekends. It knows your memberships, classes and hours, routes the call to the right instructor or salesperson, and books the lead in. No voicemail, no missed members.
            </p>
            <ul className="space-y-2.5 mb-8">
              {['Answers 24/7 in a real, human-sounding voice', 'Routes to the right person — or handles it end-to-end', 'Books trials & tours, then follows up by text'].map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-[0.9375rem]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0" style={{ background: 'rgba(232,68,37,0.9)', color: '#fff' }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
              <VoiceSampleButton />
              <VoiceWebCall fallbackHref="#book" fallbackLabel="Book your demo instead" />
            </div>
          </div>

          {/* Animated phone screen */}
          <div className="relative mx-auto w-full max-w-[460px]">
            <div className="absolute -inset-6 rounded-[2.5rem] pointer-events-none" style={{ background: 'radial-gradient(ellipse at 50% 35%, rgba(232,68,37,0.28), transparent 70%)' }} />
            <div className="relative w-full overflow-hidden rounded-2xl" style={{ aspectRatio: '700 / 745', border: '1px solid rgba(255,255,255,0.10)', boxShadow: '0 30px 80px -20px rgba(0,0,0,0.7)' }}>
              <iframe
                src="/voice-ai-never-miss.html"
                title="Xovera voice AI answering an after-hours gym call"
                loading="lazy"
                scrolling="no"
                className="absolute top-0"
                style={{ left: '-35.7%', width: '171.4%', aspectRatio: '1200 / 800', border: 0 }}
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── How it works (tinted band) ── */}
      <section className="px-6 py-16 mb-20" style={{ background: 'var(--surface-secondary)' }}>
        <div className="max-w-[1100px] mx-auto">
          <div className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight" style={{ color: 'var(--text-primary)' }}>Live in an afternoon</h2>
            <p className="mt-2 text-[0.9375rem]" style={{ color: 'var(--text-secondary)' }}>No new software for your team to learn — it works the leads you already get.</p>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-xl p-6" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-center w-8 h-8 rounded-lg mb-3 text-sm font-bold" style={{ background: 'var(--gradient-primary)', color: '#fff' }}>{s.n}</div>
                <h3 className="text-[0.9375rem] font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>{s.title}</h3>
                <p className="text-[0.875rem] leading-[1.6]" style={{ color: 'var(--text-secondary)' }}>{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Dark band: inline lead-capture form ── */}
      <section id="book" className="relative overflow-hidden mb-20 py-20 px-6 scroll-mt-20" style={{ background: 'linear-gradient(150deg, #1a0f12 0%, #20131b 45%, #0e1120 100%)' }}>
        <div className="absolute inset-0 pointer-events-none" style={{ background: 'radial-gradient(ellipse at 20% 25%, rgba(232,68,37,0.30), transparent 55%)' }} />
        <div className="relative z-10 max-w-[1080px] mx-auto grid lg:grid-cols-2 gap-12 items-center">
          {/* Copy */}
          <div>
            <div className="section-label mb-3" style={{ color: '#ff7a52' }}>Book your demo</div>
            <h2 className="text-3xl md:text-[2.5rem] font-extrabold tracking-tight leading-[1.08] mb-4" style={{ color: '#ffffff' }}>
              Stop losing members to <span className="text-gradient">slow follow-up</span>.
            </h2>
            <p className="text-[1.0625rem] leading-[1.6] mb-6" style={{ color: 'rgba(255,255,255,0.78)' }}>
              In 20 minutes we&apos;ll show Xovera answering a real lead for your gym — texting, qualifying, and booking a tour live. Grab a time, it&apos;s on us.
            </p>
            <ul className="space-y-2.5">
              {['Free while in beta — no card required', 'Live in an afternoon, no new software to learn', 'Local numbers across the US & Canada'].map((t) => (
                <li key={t} className="flex items-center gap-2.5 text-[0.9375rem]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  <span className="flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold shrink-0" style={{ background: 'rgba(232,68,37,0.9)', color: '#fff' }}>✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          {/* Form box */}
          <InlineLeadForm source="gyms_inline" cta="Book my demo →" />
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="px-6 mb-20">
        <div className="max-w-[760px] mx-auto">
          <h2 className="text-2xl font-bold tracking-tight mb-6 text-center" style={{ color: 'var(--text-primary)' }}>Gym owner questions</h2>
          <div className="vox-card p-6 md:p-8">
            {FAQS.map((f) => (
              <details key={f.q} className="group border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <summary className="flex items-center justify-between cursor-pointer py-5 font-semibold text-[0.9375rem] list-none [&::-webkit-details-marker]:hidden" style={{ color: 'var(--text-primary)' }}>
                  {f.q}
                  <span className="ml-4 transition-transform group-open:rotate-180" style={{ color: 'var(--text-tertiary)' }}>⌄</span>
                </summary>
                <p className="pb-5 text-[0.9375rem] leading-[1.65]" style={{ color: 'var(--text-secondary)' }}>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <MarketingFooter minimal />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: FAQS.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
          }),
        }}
      />
    </div>
  )
}

// SMS bubble for the "see it in action" mockup. Inbound = neutral glass,
// outbound = brand gradient.
function Bubble({ side, children }: { side: 'in' | 'out'; children: React.ReactNode }) {
  const isOut = side === 'out'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[82%] px-3.5 py-2 text-[0.875rem] leading-[1.45]"
        style={
          isOut
            ? { background: 'linear-gradient(135deg, #fa4d2e, #fb8e4a)', color: '#fff', borderRadius: '16px 16px 4px 16px' }
            : { background: 'rgba(255,255,255,0.09)', color: 'rgba(255,255,255,0.92)', borderRadius: '16px 16px 16px 4px' }
        }
      >
        {children}
      </div>
    </div>
  )
}
